import { describe, expect, test } from 'bun:test'
import { type LabelCandidate, placeLabels } from './labelFit'

/**
 * The label rule, pinned without a browser: a name is drawn only where it touches nothing and
 * sits inside the frame, and a name that cannot be drawn is dropped. The font is a fake — every
 * character is 10 px — so the arithmetic in these tests is checkable by hand.
 */
const measure = (text: string) => text.length * 10
const opts = { width: 400, height: 200, measure, gap: 4, edge: 4, lineHeight: 14 }

const node = (id: string, x: number, y: number, text: string, priority = 0): LabelCandidate => ({
  id,
  x,
  y,
  r: 5,
  text,
  priority,
})

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y - a.height / 2 < b.y + b.height / 2 &&
  a.y + a.height / 2 > b.y - b.height / 2

describe('names do not overlap', () => {
  test('two neighbours with long names: the loser takes the other side or is dropped', () => {
    const placed = placeLabels(
      [
        node('a', 60, 100, 'HbA1c', 2),
        node('b', 60, 106, 'eGFR', 1),
      ],
      opts,
    )
    expect(placed.map((p) => p.id)).toEqual(['a', 'b'])
    const a = placed[0]
    const b = placed[1]
    // the more important name got the right-hand slot it asked for first; the other moved left
    expect(a.x).toBeGreaterThan(60)
    expect(b.x + b.width).toBeLessThan(60)
    expect(overlaps(a, b)).toBe(false)
  })

  test('no two placed boxes touch, on a dense field of long names', () => {
    const candidates: LabelCandidate[] = []
    for (let i = 0; i < 60; i += 1) {
      candidates.push(node(`n${i}`, 40 + (i % 8) * 40, 20 + Math.floor(i / 8) * 22, 'Candesartan 16 mg', 60 - i))
    }
    const placed = placeLabels(candidates, opts)
    expect(placed.length).toBeGreaterThan(0)
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(overlaps(placed[i], placed[j])).toBe(false)
      }
    }
  })

  test('a name never covers another node’s circle', () => {
    // `b` sits where `a`'s name would go: the name goes left instead.
    const placed = placeLabels(
      [node('a', 170, 100, 'Type 2 diabetes', 1), node('b', 182, 100, '', 0)],
      opts,
    )
    expect(placed.length).toBe(1)
    const [label] = placed
    expect(label.x + label.width).toBeLessThanOrEqual(182 - 5 - 4)
  })
})

describe('the important name wins the space', () => {
  test('the higher priority is drawn where both want the same pixels', () => {
    const low = node('low', 100, 100, 'Candesartan 16 mg', 1)
    const high = node('high', 104, 100, 'Type 2 diabetes', 9)
    expect(placeLabels([low, high], opts).map((p) => p.id)).toEqual(['high'])
    expect(placeLabels([high, low], opts).map((p) => p.id)).toEqual(['high'])
  })

  test('the same document draws the same labels whatever order the nodes arrive in', () => {
    const a = node('a', 60, 40, 'eGFR', 3)
    const b = node('b', 62, 44, 'HbA1c', 2)
    const c = node('c', 300, 150, 'Colonoscopy report', 1)
    const one = placeLabels([a, b, c], opts).map((p) => `${p.id}:${p.x}:${p.y}`)
    const two = placeLabels([c, b, a], opts).map((p) => `${p.id}:${p.x}:${p.y}`)
    expect(one).toEqual(two)
  })
})

describe('names stay inside the frame', () => {
  test('a name under the legend moves or goes away: page chrome is an obstacle', () => {
    const legend = { x0: 0, y0: 60, x1: 200, y1: 200 }
    // right of the node would be free, but the legend covers x<200, so this name goes right.
    const placed = placeLabels([node('under', 120, 100, 'HbA1c')], { ...opts, occluders: [legend] })
    expect(placed).toEqual([])
    const moved = placeLabels([node('beside', 210, 100, 'HbA1c')], { ...opts, occluders: [legend] })
    expect(moved.length).toBe(1)
    expect(moved[0].x).toBeGreaterThanOrEqual(200)
  })

  test('a node at the right edge gets its name on the left instead', () => {
    const placed = placeLabels([node('edge', 396, 100, 'Home blood-pressure diary')], opts)
    expect(placed.length).toBe(1)
    expect(placed[0].x).toBeLessThan(396)
    expect(placed[0].x + placed[0].width).toBeLessThanOrEqual(opts.width - opts.edge)
  })

  test('a name too wide for either side is dropped, not clipped', () => {
    const placed = placeLabels([node('wide', 200, 100, 'x'.repeat(60))], opts)
    expect(placed).toEqual([])
  })

  test('a name that would hang off the top or bottom is dropped', () => {
    expect(placeLabels([node('top', 100, 1, 'Amlodipine 5 mg')], opts)).toEqual([])
  })
})
