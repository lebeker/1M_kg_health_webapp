import { describe, expect, test } from 'bun:test'
import { fitBox } from './fit'

/**
 * The fit, pinned without a browser. The numbers are the card's own canvas: 1280x497, the size
 * the defect was reported at, and the box is measured in the viewport's own pixels.
 */
const canvas = { width: 1280, height: 497 }
const margin = 20

describe('the box is the union of the circles', () => {
  test('a node is not clipped by half its radius', () => {
    const box = fitBox([{ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 10 }], canvas, margin)
    expect(box).not.toBeNull()
    // 20 + 100 of width, not 100: the circles have to be inside the frame too.
    expect(box?.width).toBe(120)
    expect(box?.cx).toBe(50)
  })

  test('the tightest axis decides the growth', () => {
    const box = fitBox([{ x: 0, y: 0, r: 0 }, { x: 100, y: 100, r: 0 }], canvas, margin)
    // 497 - 40 = 457 of height for 100 px, against 1240 of width for 100: the height is the limit.
    expect(box?.zoom).toBeCloseTo(4.57, 6)
  })

  test('a flat line is fitted by its length', () => {
    const box = fitBox([{ x: 0, y: 5, r: 0 }, { x: 400, y: 5, r: 0 }], canvas, margin)
    expect(box?.zoom).toBeCloseTo(1240 / 400, 6)
    expect(box?.height).toBe(0)
  })

  test('everything lands inside the frame with the margin, on the tightest axis', () => {
    const points = [
      { x: -120, y: 40, r: 12 },
      { x: 260, y: -90, r: 8 },
      { x: 30, y: 300, r: 20 },
    ]
    const box = fitBox(points, canvas, margin)
    expect(box).not.toBeNull()
    if (!box) return
    const spanX = box.width * box.zoom
    const spanY = box.height * box.zoom
    expect(spanX).toBeLessThanOrEqual(canvas.width - 2 * margin + 1e-6)
    expect(spanY).toBeLessThanOrEqual(canvas.height - 2 * margin + 1e-6)
    // The limit is touched, not approached: a fit that leaves a gap on its tight axis is the
    // defect this file exists for.
    expect(Math.max(spanX, spanY)).toBeCloseTo(Math.min(canvas.width, canvas.height) - 2 * margin, 6)
  })

  test('the box fills the short side of a wide canvas, not the square sigma fits', () => {
    const box = fitBox([{ x: 0, y: 0, r: 0 }, { x: 100, y: 100, r: 0 }], canvas, margin)
    expect(box).not.toBeNull()
    if (!box) return
    // the old code drew this at 76% of the height and 34% of the width, on a canvas whose height
    // was 60% unused
    expect((box.height * box.zoom) / canvas.height).toBeGreaterThan(0.9)
  })
})

describe('degenerate drawings', () => {
  test('nothing to fit', () => {
    expect(fitBox([], canvas, margin)).toBeNull()
  })

  test('one node has no extent: centre it, do not invent a growth', () => {
    const box = fitBox([{ x: 7, y: -3, r: 4 }], canvas, margin)
    expect(box?.zoom).toBe(0)
    expect(box?.cx).toBe(7)
    expect(box?.cy).toBe(-3)
  })

  test('positions that are not numbers are ignored, not multiplied into NaN', () => {
    const box = fitBox(
      [{ x: Number.NaN, y: 0, r: 1 }, { x: 0, y: 0, r: 1 }, { x: 10, y: 10, r: 1 }],
      canvas,
      margin,
    )
    expect(box?.width).toBe(12)
    expect(box?.zoom).toBeCloseTo(457 / 12, 6)
  })
})
