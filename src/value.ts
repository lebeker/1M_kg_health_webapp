/**
 * How a property reads as text.
 *
 * The rule: a value the document states comes out as itself. A kg/1 document is data, so a
 * property may be a string, a number, a list, or an object — an interval date is `{from, to}` —
 * and none of those shapes may print as `[object Object]`. That would be a value the page cannot
 * show and might as well have dropped, which is exactly the failure the node panel had before
 * `renderValue` learned about objects (T05).
 *
 * `renderValue` in App builds its cells on this and adds links for a bare identifier on top.
 * Anything that prints a value without links — the connection rows, which sit inside a button —
 * must come through here too, rather than stringifying a shape of its own.
 */
export function valueText(v: unknown): string {
  // A list joins the way the panel joins one, and its members are values in their own right:
  // joining them raw is how a list of objects turns into `[object Object]`.
  if (Array.isArray(v)) return v.map(valueText).join(' · ')
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    // An interval date reads as the span it is: `2021-05-14 → now` when it is still open.
    if (typeof o.from === 'string') {
      return typeof o.to === 'string' ? `${o.from} → ${o.to}` : `${o.from} → now`
    }
    // Any other shape keeps its own JSON instead of being flattened into nothing.
    return JSON.stringify(o)
  }
  return String(v)
}
