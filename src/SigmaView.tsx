import { useEffect, useMemo, useRef, useState } from 'react'
import Sigma from 'sigma'
import type Graph from 'graphology'
import {
  EdgeClampedProgram,
  EdgeDoubleArrowProgram,
  EdgeRectangleProgram,
  EdgeTriangleProgram,
  createEdgeArrowProgram,
} from 'sigma/rendering'
import { type Halo, type Kg, edgeDash, edgePx, edgeShape, pxSize, relationOf } from './kg'
import { type LabelCandidate, placeLabels } from './labelFit'
import { fitBox } from './fit'

type Props = {
  kg: Kg
  /** The whole document: nodes the reader collapsed are hidden here, not removed, so collapsing
   * never moves anything and expanding puts it back exactly where it was. */
  graph: Graph
  selected: string | null
  onSelect: (id: string | null) => void
  fitSignal: number
  /** How much of the right-hand side the panel covers, in px. The graph is fitted into what is
   * left of it, which is the whole point: opening a node must not hide the other nodes. */
  insetRight?: number
  /** Put this node in the middle of the view. `n` changes on every request, so following the
   * same node twice still moves the camera. */
  focus?: { id: string; n: number } | null
  /** A relation the reader is pointing at in the panel: drawn emphasised, over the top. */
  hoverEdge?: string | null
  /** What is hidden around a node -> one entry per kind, for one ring each. */
  halos?: Map<string, Halo[]>
  /** Whether those rings are drawn at all. A reader who does not care about them can turn them off. */
  halosOn?: boolean
  /** Bumped when edges were invented or withdrawn without the document changing. */
  graphVersion?: number
  /** Relation words this view is asked not to draw. */
  muted?: Set<string>
  /** Nodes the reader (or the measured budget) has collapsed away. */
  hidden?: Set<string>
  /** Does a directed relation get a head by default? The graph decides; this is that decision. */
  arrows?: boolean
  /** Multiplies every relation's width. The graph decides; this is that decision. */
  edgeScale?: number
  /** Measure this host before drawing: how many nodes it can hold at 30fps. */
  calibrating?: boolean
  /** Called once, when there is a picture: before that, whatever the page shows is a promise. */
  onFirstFrame?: () => void
  /** Day or night, because a canvas cannot read a stylesheet. */
  theme?: 'dark' | 'light'
  /** Every name drawn, a name under the pointer, or none. */
  labels?: 'on' | 'hover' | 'off'
  onMeasured?: (nodes: number) => void
}

/**
 * Sigma works in a [0,1]² space: before rendering it maps every node through
 * `0.5 + (x - centre) / span`, where span is the longer side of the graph's extent (see
 * createNormalizationFunction in sigma/dist/normalization-*.js). The camera lives in that same
 * space, which is why setting it to a node's own coordinates sends the view into empty space.
 */
function normalizer(g: { forEachNode: (cb: (id: string, a: Record<string, unknown>) => void) => void }) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  g.forEachNode((_id, a) => {
    const x = a.x as number, y = a.y as number
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const cx = (maxX + minX) / 2
  const cy = (maxY + minY) / 2
  return (x: number, y: number) => ({ x: 0.5 + (x - cx) / span, y: 0.5 + (y - cy) / span })
}

/** The shapes a document can name, so a new word is a data edit rather than a code change. */
const SHAPES: Record<string, unknown> = {
  arrow: createEdgeArrowProgram({ lengthToThicknessRatio: 4.5, widenessToThicknessRatio: 3.4 }),
  double: EdgeDoubleArrowProgram,
  clamped: EdgeClampedProgram,
  rectangle: EdgeRectangleProgram,
  triangle: EdgeTriangleProgram,
}

/** The ramp the calibration walks: node counts it shows, and holds, for a few frames each. */
const RAMP = [200, 400, 800, 1500, 2500, 4000, 6000, 9000, 13000, 18000, 25000]

/** Air between the drawing and the frame after a fit, in px. */
const FIT_MARGIN = 20

/** One font for every name the 2D view draws: standing labels and the hover tooltip. */
const LABEL_FONT = '12px ui-sans-serif, system-ui, -apple-system, sans-serif'
/** The height of one such line, in px: the box a label reserves. */
const LABEL_LINE = 14

/** The two palettes the canvas has to know about. Everything else reads a CSS variable. */
const CANVAS = {
  dark: {
    bg: '#14161a',
    edge: '#525c6b',
    dim: '#333842',
    dash: 'rgba(96,106,124,0.75)',
    label: '#c7ccd6',
    tipBg: 'rgba(16,19,25,0.94)',
    tipFg: '#e3e9f4',
    tipLine: 'rgba(130,150,180,0.35)',
  },
  light: {
    bg: '#f7f8fa',
    edge: '#b9c0cc',
    dim: '#cdd3dc',
    dash: 'rgba(150,160,175,0.95)',
    label: '#1b1f27',
    tipBg: 'rgba(255,255,255,0.97)',
    tipFg: '#1b1f27',
    tipLine: '#d0d6e0',
  },
} as const

export default function SigmaView({
  kg,
  graph,
  selected,
  onSelect,
  fitSignal,
  insetRight,
  focus,
  hoverEdge,
  halos,
  halosOn = true,
  graphVersion,
  hidden,
  muted,
  arrows = false,
  edgeScale = 1,
  calibrating = false,
  onMeasured,
  onFirstFrame,
  theme = 'dark',
  labels = 'hover',
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  // The effect below must not re-run when a parent re-renders and hands over a new closure.
  const onFirstFrameRef = useRef(onFirstFrame)
  onFirstFrameRef.current = onFirstFrame
  const sigma = useRef<Sigma | null>(null)
  /** The container size the camera was last fitted in, so a fit made against a zero-width host
   * can be redone the moment the host has a size. */
  const fitAt = useRef({ width: 0, height: 0 })
  const selRef = useRef<string | null>(selected)
  /** The node under the pointer: its name is the only label 2D draws, and only then. */
  const hoverNodeRef = useRef<string | null>(null)
  const selectRef = useRef(onSelect)
  const hoverRef = useRef<string | null>(null)
  const mutedRef = useRef<Set<string>>(new Set())
  const halosRef = useRef<Map<string, Halo[]>>(new Map())
  const halosOnRef = useRef<boolean>(true)
  const hiddenRef = useRef<Set<string>>(new Set())
  const calRef = useRef<Set<string>>(new Set())
  const drawRef = useRef<() => void>(() => {})
  const [progress, setProgress] = useState<string | null>(null)
  selRef.current = selected
  selectRef.current = onSelect
  hoverRef.current = hoverEdge ?? null
  mutedRef.current = muted ?? new Set()
  halosRef.current = halos ?? new Map()
  halosOnRef.current = halosOn !== false
  hiddenRef.current = hidden ?? new Set()

  // Fit, and this is a measurement rather than sigma's `animatedReset`: that call sets the camera
  // to the middle of sigma's normalized unit square, which on a 1280x497 canvas left the drawing
  // in the middle 40% of the width with the height half unused — and the old 1.15 backoff took
  // another 13% off the top. fit.ts unions the circles that are actually drawn and says how much
  // the picture has to grow for that box to touch the frame, less a margin, on its tightest axis.
  // The first frame is the final one: an animated fit means every reload passes through a
  // different in-between state, and a reader refreshing the page sees the map move while some
  // labels and hairlines come and go. A fit someone presses stays animated; a fit on load is
  // instant.
  const fitCamera = (s: Sigma, animate = false) => {
    const dims = s.getDimensions()
    if (!dims.width || !dims.height) return
    const g = s.getGraph()
    if (!g.order) return
    const cam = s.getCamera()
    const ratio0 = cam.getState().ratio || 1
    // Render once before measuring. `graphToViewport` answers from the matrix the last render
    // built, and between renders the camera and the container both move — the panel opening is
    // 240 px of container and the focus animation is a ratio in flight. A fit computed from that
    // matrix is a fit of a picture that is no longer on screen; a measured fresh one is the
    // picture the reader is looking at.
    s.refresh()
    const points: { x: number; y: number; r: number }[] = []
    g.forEachNode((id, a) => {
      if (hiddenRef.current.has(id) || calRef.current.has(id)) return
      if (typeof a.x !== 'number' || typeof a.y !== 'number') return
      const shown = s.getNodeDisplayData(id) as { size?: number } | undefined
      const at = s.graphToViewport({ x: a.x, y: a.y })
      // The radius sigma paints is `size / 2 / ratio` px.
      points.push({ x: at.x, y: at.y, r: (shown?.size ?? 4) / (2 * ratio0) })
    })
    const box = fitBox(points, dims, FIT_MARGIN)
    if (!box) return
    // The camera lives in sigma's normalized space, and its ratio is the inverse of the growth:
    // a smaller ratio is closer in.
    const atCentre = s.viewportToGraph({ x: box.cx, y: box.cy }, {})
    const centre = normalizer(g)(atCentre.x, atCentre.y)
    const ratio = box.zoom > 0 ? ratio0 / box.zoom : ratio0
    const target = { x: centre.x, y: centre.y, ratio, angle: 0 }
    fitAt.current = { width: dims.width, height: dims.height }
    if (animate) cam.animate(target, { duration: 320 }).catch(() => {})
    else cam.setState(target)
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    // A five-node graph should show its five labels; a thousand-node one cannot. The
    // threshold is a property of the graph, not a taste, so it is derived from it: up to
    // about a hundred nodes every label fits and every label is the point; past that,
    // weight decides which ones earn the space.
    const instance = new Sigma(graph, el, {
      renderEdgeLabels: false,
      // #2b3038 on a #14161a page is 1.1:1 — the relations were there but unreadable. A
      // field map whose lines cannot be seen is a scatter of dots.
      defaultEdgeColor: CANVAS[theme].edge,
      labelColor: { color: theme === 'light' ? '#1b1f27' : '#c7ccd6' },
      // sigma draws its own hover pill (white, centred) unless told not to: the tooltip below is
      // the one this app owns, and two names for one node is one too many.
      defaultDrawNodeHover: () => {},
      // Sigma never draws a standing label here. Its label pass keeps the first `labelDensity`
      // candidates in each 70 px cell without ever measuring one, so on a real record the
      // sentences in the dense cluster were drawn on top of each other. Both modes that show a
      // name draw it in the overlay below: hover as a tooltip, "on" through labelFit.ts, which
      // measures the boxes and drops what cannot be placed.
      labelRenderedSizeThreshold: Number.POSITIVE_INFINITY,
      labelSize: 12,
      minCameraRatio: 0.01,
      maxCameraRatio: 20,
      // Swapping to 3D unmounts this view, and the container is empty for a moment: sigma treats
      // a zero-width container as a mistake and throws — inside React's commit, which takes the
      // whole page down. The overlay's ResizeObserver sizes it again the moment it is back.
      allowInvalidContainer: true,
      edgeReducer: (edge, data) => {
        const a = kg.graph.hasEdge(edge)
          ? (kg.graph.getEdgeAttributes(edge) as Record<string, unknown>)
          : {}
        // Muted globaly, from the legend: a texture relation like a co-citation is a fact about
        // the corpus, and left in it makes every paper it touches look central.
        if (mutedRef.current.has(relationOf(a))) return { ...data, hidden: true }
        // What a relation *looks* like is a property of the relation, said in the document:
        // `style: "dotted arrow"` gives both, and nothing here changes for a new word.
        const type = edgeShape(a, arrows)
        // Dashes cannot be drawn by the GL programs sigma ships, so a dashed relation is drawn
        // by the overlay instead and must not also be drawn solid underneath it.
        if (edgeDash(a) && hoverRef.current !== edge) return { ...data, hidden: true }
        return { ...data, type, size: edgePx(a, edgeScale) }
      },
      nodeReducer: (node, data) => {
        // Collapsed away: still in the graph, not drawn, and not labelable either.
        if (hiddenRef.current.has(node) || calRef.current.has(node)) {
          return { ...data, hidden: true, label: '' }
        }
        // Already in pixels: the data layer resolved `weight`/`size` once, for every renderer.
        data.size = typeof data.px === 'number' ? data.px : pxSize(data.size)
        const sel = selRef.current
        if (!sel || node === sel) return data
        // Dimmed, not shrunk: relative size is the reading, and hiding it while something is
        // selected throws away the thing the map is for.
        return { ...data, color: CANVAS[theme].dim, label: '', size: Math.min(data.size, 24) }
      },
    })

    instance.on('clickNode', ({ node }) => selectRef.current(node))
    instance.on('clickStage', () => selectRef.current(null))
    // sigma's arrowhead is 2.5x the thickness of the line, so on an ordinary 1.4px relation it
    // is a triangle four pixels long: drawn, and invisible. A citation pointing the wrong way
    // is worse than no arrow at all, so this viewer registers a head worth seeing — along with
    // the other shapes a document may name by hand, which sigma does not register at all.
    const reg = instance as unknown as { registerEdgeProgram: (t: string, p: unknown) => void }
    for (const [name, program] of Object.entries(SHAPES)) reg.registerEdgeProgram(name, program)
    fitCamera(instance)

    // ── the overlay ────────────────────────────────────────────────────────────────────────
    // What the GL pipeline cannot do, drawn in 2D on top of it: dashes and dots (any pattern,
    // any colour), a ring around a node whose neighbours are collapsed inside it, and the
    // relation the reader is pointing at.
    const canvas = document.createElement('canvas')
    canvas.className = 'overlay'
    el.appendChild(canvas)
    const ctx = canvas.getContext('2d')

    // Measuring is the expensive half of placing a name, and a record repeats its words ("City
    // Lab" appears in half the labels): measure each distinct string once per mounted view.
    const widths = new Map<string, number>()
    const measureLabel = (text: string) => {
      const known = widths.get(text)
      if (known !== undefined) return known
      const w = ctx ? ctx.measureText(text).width : text.length * 7
      widths.set(text, w)
      return w
    }

    // What the page has painted over the canvas — the legend, the node panel — in canvas px. A
    // name under the legend is a name nobody can read, so the label pass treats these as walls.
    // Re-measured on a short cycle rather than every frame (reading rects forces layout), and a
    // change in what is over the map buys one redraw: the first frame is drawn under the
    // "laying out" sheet, and names placed against that sheet would be missing until the reader
    // happened to touch the map.
    let occluders: { x0: number; y0: number; x1: number; y1: number }[] = []
    let occludersAt = 0
    let chase: ReturnType<typeof setTimeout> | null = null
    let chases = 0
    const chromeOver = () => {
      const box = el.getBoundingClientRect()
      const found: { x0: number; y0: number; x1: number; y1: number }[] = []
      if (!box.width || !box.height) return found
      let node: HTMLElement | null = el
      for (let depth = 0; depth < 3 && node?.parentElement; depth += 1) {
        const parent: HTMLElement = node.parentElement
        for (const child of Array.from(parent.children)) {
          // The canvas itself, and any wrapper of it, is what is being drawn on, not over.
          if (child === node || !(child instanceof HTMLElement) || child.contains(el)) continue
          const r = child.getBoundingClientRect()
          if (r.width < 4 || r.height < 4) continue
          if (r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom) {
            continue
          }
          found.push({
            x0: r.left - box.left,
            y0: r.top - box.top,
            x1: r.right - box.left,
            y1: r.bottom - box.top,
          })
        }
        node = parent
      }
      return found
    }
    const chromeKey = (list: { x0: number; y0: number; x1: number; y1: number }[]) =>
      list.map((o) => `${Math.round(o.x0)},${Math.round(o.y0)},${Math.round(o.x1)},${Math.round(o.y1)}`).join('|')

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const draw = () => {
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
      const at = (x: number, y: number) => instance.graphToViewport({ x, y })
      const ratio = instance.getCamera().getState().ratio || 1
      // sigma's node shader draws `a_size / u_sizeRatio`, so a ring measured in the unscaled
      // space ends up inside the circle as soon as the reader zooms in.
      // The radius sigma actually paints. Its node shader sets gl_PointSize = a_size / u_sizeRatio,
      // which is a *diameter* in device pixels, so the radius is half that — the ring used to be
      // drawn at four times the node's radius and read as a second, bigger circle.
      const radius = (id: string) => {
        const d = instance.getNodeDisplayData(id) as { size?: number } | undefined
        return (d?.size ?? 4) / (2 * ratio)
      }
      // `hasNode` before anything else: a caller can hand over an id that is not on the map
      // (a collapse with no host, a stale selection), and asking the graph for its position
      // throws — inside an effect, which takes the whole page down with it.
      const visible = (id: string) =>
        !!id && kg.graph.hasNode(id) && !hiddenRef.current.has(id) && !calRef.current.has(id)
      const point = (id: string) => {
        const n = kg.graph.getNodeAttributes(id) as { x: number; y: number }
        return at(n.x, n.y)
      }

      // Relations the GL path is not drawing: dashed and dotted ones.
      kg.graph.forEachEdge((edge, a, source, target) => {
        const dash = edgeDash(a as Record<string, unknown>)
        if (!dash) return
        // Muted in the legend: the overlay draws what the GL pass does not, so it has to agree
        // with it about what is left out.
        if (mutedRef.current.has(relationOf(a as Record<string, unknown>))) return
        if (!visible(source) || !visible(target)) return
        const s = point(source)
        const t = point(target)
        const hovered = hoverRef.current === edge
        ctx.save()
        ctx.setLineDash(dash)
        ctx.lineCap = 'round'
        ctx.strokeStyle = hovered
          ? '#9dc0ff'
          : ((a as Record<string, unknown>).color as string) || CANVAS[theme].dash
        ctx.lineWidth = (edgePx(a as Record<string, unknown>, edgeScale) || 1) * (hovered ? 3 : 1)
        if (hovered) {
          ctx.shadowColor = 'rgba(120,170,255,0.9)'
          ctx.shadowBlur = 8
        }
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(t.x, t.y)
        ctx.stroke()
        ctx.restore()
      })

      // A relation the reader is pointing at in the panel: solid ones are drawn by GL, so this
      // goes over them rather than instead of them.
      const h = hoverRef.current
      if (h && kg.graph.hasEdge(h)) {
        const a = kg.graph.getEdgeAttributes(h) as Record<string, unknown>
        const [source, target] = kg.graph.extremities(h)
        if (!edgeDash(a) && visible(source) && visible(target)) {
          const s = point(source)
          const t = point(target)
          ctx.save()
          ctx.strokeStyle = '#9dc0ff'
          ctx.shadowColor = 'rgba(120,170,255,0.9)'
          ctx.shadowBlur = 9
          ctx.lineWidth = edgePx(a, edgeScale) + 2.2
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(t.x, t.y)
          ctx.stroke()
          ctx.restore()
        }
      }

      // Rings: a node with nodes collapsed inside it says how much is hidden, and collapsing a
      // small weak thing and a large strong one should not look the same.
      if (halosRef.current.size && halosOnRef.current) {
        halosRef.current.forEach((kinds, id) => {
          if (!visible(id)) return
          const p = point(id)
          const r0 = radius(id)
          // One ring per kind, in that kind's own colour, the heaviest closest to the node — so a
          // collapsed company and a collapsed researcher are told apart without reading anything.
          // The ring sits *just* outside the node: two line widths of air, then one ring per kind
          // spaced by its own width, so a ring never reads as a second, larger circle.
          kinds.forEach((h, i) => {
            const lw = 1.5 + Math.min(4, Math.sqrt(Math.max(0, h.mass)) * 0.7)
            ctx.save()
            ctx.strokeStyle = h.color
            ctx.globalAlpha = 0.75
            ctx.lineWidth = lw
            ctx.beginPath()
            ctx.arc(p.x, p.y, r0 + 2 * lw + i * (lw + 2), 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          })
        })
      }

      // Names, when the reader asked for them. Each one is measured and checked against what is
      // already on the canvas (labelFit.ts): a name that would land on another name, on a node,
      // or off the frame is dropped, because a second layer of grey text over grey text explains
      // nothing. Weight decides who is asked first, so the node the map is about keeps its name.
      if (labels === 'on') {
        const sel = selRef.current
        const candidates: LabelCandidate[] = []
        kg.graph.forEachNode((id, a) => {
          if (!visible(id)) return
          // With something selected the rest of the map is dimmed and unsaid; a standing name
          // there would undo the selection.
          const text = sel && id !== sel ? '' : String(a.label ?? '')
          if (!text) return
          const p = at(a.x as number, a.y as number)
          candidates.push({
            id,
            x: p.x,
            y: p.y,
            r: radius(id),
            text,
            priority: id === sel ? Number.MAX_SAFE_INTEGER : typeof a.weight === 'number' ? a.weight : 0,
          })
        })
        ctx.save()
        ctx.font = LABEL_FONT
        if (Date.now() - occludersAt > 200) {
          const next = chromeOver()
          if (chromeKey(next) !== chromeKey(occluders)) {
            // Something was put over the map, or taken off it. One redraw after the dust settles
            // is enough to place the names against what is actually there.
            if (chase) clearTimeout(chase)
            if (chases < 5) {
              chases += 1
              chase = setTimeout(() => {
                chase = null
                drawRef.current()
              }, 240)
            }
          } else {
            chases = 0
          }
          occluders = next
          occludersAt = Date.now()
        }
        const placed = placeLabels(candidates, {
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          measure: measureLabel,
          gap: 5,
          edge: 2,
          lineHeight: LABEL_LINE,
          occluders,
        })
        ctx.textBaseline = 'middle'
        ctx.fillStyle = CANVAS[theme].label
        for (const l of placed) ctx.fillText(l.text, l.x, Math.round(l.y) + 0.5)
        ctx.restore()
        // What was drawn, on the element: a reviewer can tell "labels on" from "labels on with
        // nothing colliding" without counting pixels. The placed boxes are the handle a test
        // reads: "no two of these overlap" is a claim about numbers, not about a screenshot.
        el.setAttribute('data-labels-drawn', String(placed.length))
        ;(el as unknown as { __labels__?: typeof placed }).__labels__ = placed
      } else if (el.hasAttribute('data-labels-drawn')) {
        el.removeAttribute('data-labels-drawn')
        ;(el as unknown as { __labels__?: unknown[] }).__labels__ = []
      }

      // The name of whatever the reader is pointing at. Drawn here, not by sigma, because a
      // label that follows the cursor has to escape the label-density rule that governs the map.
      const pointed = hoverNodeRef.current
      if (pointed && visible(pointed)) {
        const label = String(kg.graph.getNodeAttributes(pointed).label ?? pointed)
        if (label) {
          const p = point(pointed)
          const r = radius(pointed)
          ctx.save()
          ctx.font = LABEL_FONT
          ctx.textBaseline = 'middle'
          const padX = 7
          const padY = 5
          const w = Math.ceil(ctx.measureText(label).width)
          const boxW = w + padX * 2
          const boxH = 12 + padY * 2
          const left = Math.min(Math.max(3, p.x - boxW / 2), canvas.width / dpr - boxW - 3)
          const top = Math.max(3, p.y - r - boxH - 5)
          ctx.beginPath()
          ctx.roundRect(left, top, boxW, boxH, 5)
          ctx.fillStyle = CANVAS[theme].tipBg
          ctx.fill()
          ctx.strokeStyle = CANVAS[theme].tipLine
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.fillStyle = CANVAS[theme].tipFg
          ctx.fillText(label, left + padX, top + boxH / 2 + 0.5)
          ctx.restore()
        }
      }
    }
    drawRef.current = draw

    sizeCanvas()
    instance.on('afterRender', draw)
    // Hover is measured here rather than taken from sigma's own `enterNode`: that event is
    // computed from the picking buffer and only fires for a trusted mouse on sigma's own layer,
    // which makes "does the tooltip work" untestable and leaves a second source of truth.
    let hoverFrame = 0
    const onMove = (event: MouseEvent) => {
      if (hoverFrame) return
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0
        const rect = el.getBoundingClientRect()
        const vx = event.clientX - rect.left
        const vy = event.clientY - rect.top
        const ratio = instance.getCamera().getState().ratio || 1
        let best: string | null = null
        let bestDist = Infinity
        kg.graph.forEachNode((id, a) => {
          if (hiddenRef.current.has(id) || calRef.current.has(id)) return
          if (typeof a.x !== 'number' || typeof a.y !== 'number') return
          const p = instance.graphToViewport({ x: a.x, y: a.y })
          const shown = instance.getNodeDisplayData(id) as { size?: number } | undefined
          const r = (shown?.size ?? 4) / (2 * ratio)
          const d = Math.hypot(p.x - vx, p.y - vy)
          // A little tolerance: pointing at a two-pixel dot is not a precision task.
          if (d <= Math.max(7, r + 2) && d < bestDist) {
            bestDist = d
            best = id
          }
        })
        // On the element, so a test can see what the pointer found without reading pixels.
        el.setAttribute('data-hover', best ?? '')
        if (best !== hoverNodeRef.current) {
          hoverNodeRef.current = best
          drawRef.current?.()
        }
      })
    }
    const onLeave = () => {
      if (!hoverNodeRef.current) return
      hoverNodeRef.current = null
      drawRef.current?.()
    }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    // The first frame is the end of the wait, not the start of one.
    let said = false
    instance.on('afterRender', () => {
      if (said) return
      said = true
      onFirstFrameRef.current?.()
    })
    // A container with no width is not a reason to resize: sigma throws on it, and a
    // ResizeObserver callback can arrive after the view was swapped out for 3D. A renderer that
    // cannot resize is a renderer to leave alone — never a reason to take the page down.
    const safeResize = () => {
      if (!el.isConnected || !el.clientWidth || !el.clientHeight) return
      try {
        instance.resize()
      } catch (err) {
        console.warn('sigma resize failed:', err)
      }
    }
    const ro = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return
      sizeCanvas()
      safeResize()
      // A fit made while the host had no size (the 3D toggle unmounts this view, and the graph
      // view can be opened before the layout has run) is a fit of nothing: redo it the moment the
      // host is real. Once a real fit exists the camera is the reader's, and a resize leaves it
      // alone.
      if (fitAt.current.width < 8 || fitAt.current.height < 8) fitCamera(instance)
      draw()
    })
    ro.observe(el)

    sigma.current = instance
    // A handle for tests and for anyone reading the page in a console: the instance is otherwise
    // private, and "is the tooltip where it should be" is not a question the DOM can answer.
    ;(el as unknown as { __sigma__?: Sigma }).__sigma__ = instance
    return () => {
      // Stop watching before the instance goes: a resize reported after `kill()` is a callback
      // on a dead renderer, and sigma answers it by throwing at a container it can no longer size.
      ro.disconnect()
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
      if (hoverFrame) cancelAnimationFrame(hoverFrame)
      if (chase) clearTimeout(chase)
      canvas.remove()
      sigma.current = null
      drawRef.current = () => {}
      try {
        instance.kill()
      } catch {
        // Already gone: the only thing left to do with a dead renderer is to stop touching it.
      }
    }
  }, [graph, kg, arrows, edgeScale, theme, labels])

  // selection only changes how nodes are drawn: refresh, never rebuild
  useEffect(() => {
    sigma.current?.refresh()
  }, [selected])

  // Collapsing a node, or pointing at a relation: a repaint, not a rebuild.
  useEffect(() => {
    sigma.current?.refresh()
    drawRef.current()
  }, [hidden, hoverEdge, halos, halosOn, graphVersion])

  // ── measuring this host ────────────────────────────────────────────────────────────────
  // The budget is what this machine can draw, so it is measured on this machine: the graph is
  // revealed in growing steps and the frame time is watched. That is what the loading screen
  // is — not a decoration, the measurement. A number written into the document would be a
  // claim about a computer the document has never met.
  useEffect(() => {
    const s = sigma.current
    if (!calibrating || !s || !onMeasured) return
    // Biggest first: if the ramp can only show part of the graph, it should show the part that
    // matters, and the reader watches the map build itself while it measures.
    const order = [...kg.graph.nodes()]
      .map((id) => ({ id, w: kg.graph.getNodeAttribute(id, 'weight') ?? 0 }))
      .sort((a, b) => b.w - a.w)
      .map((d) => d.id)
    const steps = RAMP.filter((n) => n <= kg.graph.order)
    if (!steps.length || steps[steps.length - 1] < kg.graph.order) steps.push(kg.graph.order)
    let step = 0
    let frames: number[] = []
    let last = performance.now()
    let raf = 0
    let done = false
    let lastGood = 0

    const show = (n: number) => {
      const count = Math.min(n, order.length)
      calRef.current = new Set(order.slice(count))
      s.refresh()
      return count
    }

    const tick = () => {
      if (done) return
      const now = performance.now()
      const dt = now - last
      last = now
      if (dt < 1000) frames.push(dt)
      if (frames.length >= 14) {
        const sorted = [...frames].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        const shown = Math.min(steps[step], order.length)
        const held = median <= 33
        if (!held || step >= steps.length - 1) {
          // The last count that held — or, if even the first step did not, a floor rather than
          // zero: a budget of zero hides everything, which is a broken page, not a measurement.
          done = true
          calRef.current = new Set()
          s.refresh()
          setProgress(null)
          onMeasured(held ? shown : Math.max(50, Math.round(lastGood / 2) || 200))
          return
        }
        lastGood = shown
        frames = []
        step += 1
        const next = show(steps[step])
        setProgress(`${next} nodes · ${Math.round(1000 / median)} fps`)
      }
      raf = requestAnimationFrame(tick)
    }

    setProgress('measuring this machine…')
    const start = window.setTimeout(() => {
      show(steps[0])
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }, 150)

    return () => {
      done = true
      window.clearTimeout(start)
      cancelAnimationFrame(raf)
      calRef.current = new Set()
      setProgress(null)
      // Leaving 2D while the budget is still being measured unmounts the renderer first: its
      // cleanup runs before this one, so `sigma.current` is already null. Refreshing a killed
      // renderer throws inside React's commit and takes the whole page with it — which is
      // exactly what switching to 3D did on a graph big enough to be measured.
      if (sigma.current === s) s.refresh()
    }
  }, [calibrating, kg, onMeasured])

  // Re-fit when asked, and when the panel opens or closes — the renderer is narrower then, so
  // the graph must be fitted again rather than left half-hidden behind the panel.
  useEffect(() => {
    const s = sigma.current
    const box = host.current
    if (!s || !box?.isConnected || !box.clientWidth || !box.clientHeight) return
    try {
      s.resize()
    } catch (err) {
      console.warn('sigma resize failed:', err)
    }
    fitCamera(s, fitSignal > 0)
  }, [fitSignal, insetRight])

  // Follow a connection: put that node in the middle. The canvas is already narrower than the
  // window while the panel is open, so centring on the canvas is centring in what can be seen.
  useEffect(() => {
    const s = sigma.current
    if (!s || !focus || !graph.hasNode(focus.id)) return
    const attrs = graph.getNodeAttributes(focus.id) as { x?: number; y?: number }
    if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') return
    const at = normalizer(graph)(attrs.x, attrs.y)
    const cam = s.getCamera()
    const state = cam.getState()
    // Zoomed far out a single node is a dot: come in far enough to see what was clicked, but
    // never push the camera back out of a view the reader already chose.
    const ratio = Math.min(state.ratio, 0.45)
    cam.animate({ ...state, x: at.x, y: at.y, ratio }, { duration: 450 })
  }, [focus, graph])

  // The layout is the picture: if two loads of the same document disagree here, the document is
  // the same and the drawing is not — which is exactly what "it rotates on refresh" means.
  const posHash = useMemo(() => {
    let h = 2166136261
    kg.graph.forEachNode((id, a) => {
      const x = Math.round((Number(a.x) || 0) * 10)
      const y = Math.round((Number(a.y) || 0) * 10)
      const text = `${id}:${x},${y};`
      for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
    })
    return (h >>> 0).toString(36)
  }, [kg])

  return (
    <div
      className="canvas"
      ref={host}
      data-pos-hash={posHash}
      // What was actually drawn, on the element: a page that draws something different from what
      // it was asked to draw is hard to see from the outside, and this is how a test sees it.
      data-drawn={kg.graph.order - (hidden?.size ?? 0)}
      data-collapsed={hidden?.size ?? 0}
      // how many rings are on screen, not how many nodes wear them
      // how many rings are on screen, not how many nodes wear them — and none when they are off
      data-rings={halosOn === false ? 0 : [...(halos?.values() ?? [])].reduce((n, k) => n + k.length, 0)}
      data-halos={halosOn === false ? 'off' : 'on'}
      // What mode the names are in — "on" draws them standing (labelFit.ts decides which ones
      // fit), "hover" a tooltip under the pointer, "off" neither.
      data-labels={labels}
      style={insetRight ? { width: `calc(100% - ${insetRight}px)` } : undefined}
    >
      {progress ? (
        <div className="measuring">
          <b>measuring this machine</b>
          <span>{progress}</span>
          <i>the graph is revealed as fast as this host can hold it</i>
        </div>
      ) : null}
    </div>
  )
}
