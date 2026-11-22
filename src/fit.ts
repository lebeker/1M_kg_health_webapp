/**
 * The camera state that shows the whole drawing, with a margin.
 *
 * Sigma's own `animatedReset` is not a fit. It sets the camera to `{x: .5, y: .5, ratio: 1}`,
 * which is the middle of the *normalized* unit square, a box sigma builds from the longer side of
 * the graph's extent. On a 1280x497 canvas that box is height-limited: the drawing came out in
 * the middle 40% of the width with half the height unused above and below, and the old code then
 * multiplied the ratio by 1.15 "to leave room for labels", taking another 13% off the top.
 *
 * A fit is a measurement, not a constant: take every circle that is actually drawn, union them
 * into one box, and ask how much the picture has to grow so that box touches the frame on its
 * tightest axis, less the margin. The box is the union of the *circles*, so a node is never half
 * outside the frame — a fit that clips the thing it is fitting is not a fit.
 *
 * The units here are the viewport's own: px, which is what a screenshot and a reader both
 * measure. `zoom` is how much the picture grows; the camera's ratio moves the other way
 * (`ratio / zoom`), because a smaller ratio is closer in.
 *
 * Pure: the renderer supplies the points it is drawing, and a test can check the arithmetic.
 */

export type FitPoint = {
  /** The node's centre, in viewport px. */
  x: number
  y: number
  /** The node's drawn radius, in viewport px. */
  r: number
}

export type FitBox = {
  /** Centre of the box, in viewport px. */
  cx: number
  cy: number
  /** How much the picture has to grow to fit. `0` when the drawing has no extent at all. */
  zoom: number
  /** The box's size, in viewport px, before that growth. */
  width: number
  height: number
}

/**
 * @param margin px of air that must be left between the drawing and the frame.
 * @returns `null` when there is nothing to fit, and `zoom: 0` for a drawing with no extent (one
 *          node, or every node in the same place): the caller then centres it and keeps the
 *          scale it already had, because a growth computed from zero is infinite.
 */
export function fitBox(
  points: FitPoint[],
  viewport: { width: number; height: number },
  margin: number,
): FitBox | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let cMinX = Number.POSITIVE_INFINITY
  let cMaxX = Number.NEGATIVE_INFINITY
  let cMinY = Number.POSITIVE_INFINITY
  let cMaxY = Number.NEGATIVE_INFINITY
  let seen = 0
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const r = Number.isFinite(p.r) && p.r > 0 ? p.r : 0
    if (p.x - r < minX) minX = p.x - r
    if (p.x + r > maxX) maxX = p.x + r
    if (p.y - r < minY) minY = p.y - r
    if (p.y + r > maxY) maxY = p.y + r
    if (p.x < cMinX) cMinX = p.x
    if (p.x > cMaxX) cMaxX = p.x
    if (p.y < cMinY) cMinY = p.y
    if (p.y > cMaxY) cMaxY = p.y
    seen += 1
  }
  if (!seen) return null

  const width = maxX - minX
  const height = maxY - minY
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  // Every node in the same place: there is a circle but no drawing, and a scale computed from a
  // circle would blow that circle up to fill the frame. The caller centres it and keeps the
  // scale it already had.
  if (cMaxX - cMinX === 0 && cMaxY - cMinY === 0) return { cx, cy, zoom: 0, width, height }

  const availW = Math.max(1, viewport.width - 2 * margin)
  const availH = Math.max(1, viewport.height - 2 * margin)
  // A box with no extent in one direction puts no constraint on that axis — a flat line of nodes
  // is fitted by its length, not by its zero height.
  const growX = width > 0 ? availW / width : Number.POSITIVE_INFINITY
  const growY = height > 0 ? availH / height : Number.POSITIVE_INFINITY
  const zoom = Math.min(growX, growY)
  return { cx, cy, zoom: Number.isFinite(zoom) ? zoom : 0, width, height }
}
