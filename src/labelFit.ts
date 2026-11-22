/**
 * Where a name goes, and whether it is drawn at all.
 *
 * Sigma picks labels by *density*: it bins node positions into a grid and keeps the first
 * `labelDensity` candidates in each cell (labelDensity.ts in sigma). That rule never measures a
 * label, so two names in neighbouring cells — or a 200 px sentence whose node sits in a 70 px
 * cell — are drawn on top of each other. On a health record the labels are sentences
 * ("Annual check-up — City Lab, 18 Apr 2006"), so the central cluster came out as a pile of
 * grey text over grey text: unreadable, and it buried the map it was meant to explain.
 *
 * This is the rule the viewer actually wants, and it fits in one sentence: **a name is drawn if
 * its box is inside the frame and touches nothing already drawn, and a name that cannot be
 * drawn is dropped rather than overdrawn.** Boxes are real measured rectangles, so the promise
 * is about pixels rather than about a grid.
 *
 * Pure, and kept out of the renderer: "does this label overlap that one" is a question a test
 * can answer without a canvas or a browser.
 */

export type LabelCandidate = {
  id: string
  /** The node's centre, in viewport px. */
  x: number
  y: number
  /** The node's drawn radius, in viewport px: a name never sits on its own circle. */
  r: number
  text: string
  /** Bigger wins the space when two names want the same pixels. */
  priority: number
}

export type PlacedLabel = {
  id: string
  text: string
  /** Left edge, in viewport px. */
  x: number
  /** Vertical centre, in viewport px — the text is drawn on the node's own baseline. */
  y: number
  width: number
  height: number
}

export type LabelFitOptions = {
  /** The viewport the labels have to live in, in px. */
  width: number
  height: number
  /** Measured width of a string, in px. The caller owns the font. */
  measure: (text: string) => number
  /** Distance between a circle and its name, and between two names. */
  gap?: number
  /** How close a name may come to the edge of the frame. */
  edge?: number
  /** The height of one line of text, in px. */
  lineHeight?: number
  /**
   * Panels the page has painted over the canvas — the legend, the node panel — in viewport px.
   * A name under the legend is a name the reader cannot read, which is the same defect as a name
   * under another name, so these block placement exactly as the circles do.
   */
  occluders?: Rect[]
}

export type Rect = { x0: number; y0: number; x1: number; y1: number }

const CELL = 64

/** The cell range a rectangle touches. Clamped, so a huge rectangle cannot spin a loop. */
function cellsOf(r: Rect, columns: number, rows: number): [number, number, number, number] {
  const c0 = Math.max(0, Math.floor(r.x0 / CELL))
  const c1 = Math.min(columns - 1, Math.floor(r.x1 / CELL))
  const r0 = Math.max(0, Math.floor(r.y0 / CELL))
  const r1 = Math.min(rows - 1, Math.floor(r.y1 / CELL))
  return [c0, r0, c1, r1]
}

/**
 * Place as many names as fit. `priority` decides who is asked first, which is what makes the
 * result stable: the important node keeps its name and the crowd around it loses theirs, rather
 * than the winner depending on iteration order.
 */
export function placeLabels(candidates: LabelCandidate[], opts: LabelFitOptions): PlacedLabel[] {
  const gap = opts.gap ?? 4
  const edge = opts.edge ?? 4
  const lineHeight = opts.lineHeight ?? 14
  const width = Math.max(1, opts.width)
  const height = Math.max(1, opts.height)
  if (!candidates.length) return []

  const columns = Math.max(1, Math.ceil(width / CELL))
  const rows = Math.max(1, Math.ceil(height / CELL))
  const taken: Rect[][] = Array.from({ length: rows * columns }, () => [])

  const add = (r: Rect) => {
    const [c0, r0, c1, r1] = cellsOf(r, columns, rows)
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) taken[row * columns + col].push(r)
    }
  }
  const free = (r: Rect) => {
    const [c0, r0, c1, r1] = cellsOf(r, columns, rows)
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        for (const other of taken[row * columns + col]) {
          if (r.x0 < other.x1 && r.x1 > other.x0 && r.y0 < other.y1 && r.y1 > other.y0) return false
        }
      }
    }
    return true
  }
  const inside = (r: Rect) =>
    r.x0 >= edge && r.y0 >= edge && r.x1 <= width - edge && r.y1 <= height - edge

  // The circles are obstacles before any name is placed: a name over another node's dot is the
  // same defect as a name over another name. A node's own circle is outside its label box by
  // construction, so it never blocks itself.
  for (const c of candidates) {
    add({ x0: c.x - c.r - gap, y0: c.y - c.r - gap, x1: c.x + c.r + gap, y1: c.y + c.r + gap })
  }
  // So is the page's own chrome: what it covers, the map cannot show a name through.
  for (const r of opts.occluders ?? []) add(r)

  // Biggest first, then by id: two loads of the same document must produce the same picture.
  const order = [...candidates].sort((a, b) =>
    b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  const placed: PlacedLabel[] = []
  for (const c of order) {
    const text = c.text.trim()
    if (!text) continue
    const w = opts.measure(text)
    if (!Number.isFinite(w) || w <= 0) continue
    const h = lineHeight
    // Right of the circle first, the way a name reads beside a dot; the left side is the second
    // chance, because a node at the right edge of the frame still deserves its name.
    const right = c.x + c.r + gap
    const left = c.x - c.r - gap - w
    const options: Rect[] = [
      { x0: right, y0: c.y - h / 2, x1: right + w, y1: c.y + h / 2 },
      { x0: left, y0: c.y - h / 2, x1: left + w, y1: c.y + h / 2 },
    ]
    for (const box of options) {
      if (!inside(box) || !free(box)) continue
      add(box)
      placed.push({ id: c.id, text, x: box.x0, y: c.y, width: w, height: h })
      break
    }
  }
  return placed
}
