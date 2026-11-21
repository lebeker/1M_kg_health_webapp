/* The timeline player's arithmetic — which event comes next.
 *
 * Pure on purpose: no DOM, no document, no state, so `scripts/timeline-player.test.ts` can pin
 * the stepping rules without a browser and the page can stay in charge of what a "selected
 * date" looks like.
 *
 * The rule the card asked for: the player steps between *events*, not between ticks. A ruler
 * with a month grid has 49 stops in the zoom window and an event may sit anywhere inside it,
 * so the player has to know the addresses events live at. It never invents one: when there is
 * no event on the far side of the current date, it returns null and the timeline does not move.
 */
(function (root) {
  "use strict";

  /* two events on one day are one stop: the address is a calendar day, not a timestamp */
  function dayKey(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  /* Every address the player may stop at: each dated event, one per day, oldest first.
     Anything that does not parse as a date is not an address. */
  function addresses(times) {
    const seen = new Set();
    const out = [];
    (times || []).forEach((t) => {
      const ms = typeof t === "number" ? t : Date.parse(String(t));
      if (!Number.isFinite(ms)) return;
      const k = dayKey(ms);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(ms);
    });
    return out.sort((a, b) => a - b);
  }

  /* where: "start" | "prev" | "next" | "end". `current` is the time the timeline points at now.
     Returns the address to move to, or null when there is nowhere to go — the player clamps,
     it never wraps, so a click at the end of the record does not teleport the reader to 1984. */
  function step(times, current, where) {
    const at = addresses(times);
    if (!at.length) return null;
    if (where === "start") return at[0];
    if (where === "end") return at[at.length - 1];
    const cur = Number.isFinite(current) ? current : null;
    if (cur === null) return null;
    if (where === "prev") {
      let pick = null;
      at.forEach((t) => {
        if (t < cur) pick = t;
      });
      return pick;
    }
    if (where === "next") {
      let pick = null;
      at.forEach((t) => {
        if (pick === null && t > cur) pick = t;
      });
      return pick;
    }
    return null;
  }

  root.TimelineStep = Object.freeze({ addresses: addresses, step: step, dayKey: dayKey });
})(typeof globalThis !== "undefined" ? globalThis : this);
