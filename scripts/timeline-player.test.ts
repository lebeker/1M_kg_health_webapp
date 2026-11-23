import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * T07 — the timeline is a navigator, not a filter.
 *
 * The card's behaviour lives in two places and both are pinned here:
 *   1. `body/lib/timeline-step.js` — which event the player moves to. Pure, so the rules can be
 *      stated as dates rather than clicks.
 *   2. `body/index.html` — the ruler's own geometry and inputs (birth → +40 years, ±2 years by
 *      month, future ticks coloured by risk, a click anywhere on the strip, no wheel).
 *
 * The dynamic half — the buttons actually moving the marker in a browser — is the acceptance run
 * recorded on the card; these checks fail when the code stops expressing the rule, which is what
 * a unit gate is for.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')

type TimelineStep = {
  addresses: (times: Array<number | string>) => number[]
  step: (times: Array<number | string>, current: number, where: string) => number | null
  dayKey: (ms: number) => number
}
const sandbox: { TimelineStep?: TimelineStep } = {}
vm.createContext(sandbox)
vm.runInContext(read('body/lib/timeline-step.js'), sandbox)
const TL = sandbox.TimelineStep as TimelineStep

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10))
const at = (day: string) => Date.parse(day)

const EVENTS = ['2022-06-03', '2019-04-12', '2024-10-15']

describe('the player steps between events, not between ticks', () => {
  test('the addresses are the event dates, oldest first, whatever order the document used', () => {
    expect(TL.addresses(EVENTS).map(iso)).toEqual(['2019-04-12', '2022-06-03', '2024-10-15'])
  })

  test('two events on one day are one stop — the address is a calendar day', () => {
    const times = ['2019-04-12T06:00:00Z', '2019-04-12T18:00:00Z', '2022-06-03']
    expect(TL.addresses(times).length).toBe(2)
    expect(TL.addresses(times).map(iso)).toEqual(['2019-04-12', '2022-06-03'])
  })

  test('anything that is not a date is not an address', () => {
    expect(TL.addresses(['2019-04-12', '', 'not a date', null as unknown as string, undefined as unknown as string]))
      .toEqual([at('2019-04-12')])
    expect(TL.addresses([])).toEqual([])
  })

  test('start and end land on the first and the last event', () => {
    expect(iso(TL.step(EVENTS, at('2021-01-01'), 'start'))).toBe('2019-04-12')
    expect(iso(TL.step(EVENTS, at('2021-01-01'), 'end'))).toBe('2024-10-15')
  })

  test('prev and next are the neighbouring events on either side of the chosen date', () => {
    expect(iso(TL.step(EVENTS, at('2021-01-01'), 'prev'))).toBe('2019-04-12')
    expect(iso(TL.step(EVENTS, at('2021-01-01'), 'next'))).toBe('2022-06-03')
  })

  test('a chosen date that is itself an event steps past it, not onto it', () => {
    expect(iso(TL.step(EVENTS, at('2022-06-03'), 'next'))).toBe('2024-10-15')
    expect(iso(TL.step(EVENTS, at('2022-06-03'), 'prev'))).toBe('2019-04-12')
  })

  test('the ends clamp: no wrap back to the beginning of the record', () => {
    expect(TL.step(EVENTS, at('2019-04-12'), 'prev')).toBeNull()
    expect(TL.step(EVENTS, at('2024-10-15'), 'next')).toBeNull()
    expect(TL.step(EVENTS, at('2030-01-01'), 'next')).toBeNull()
    expect(TL.step(EVENTS, at('1990-01-01'), 'prev')).toBeNull()
  })

  test('no events, no movement — every button answers null', () => {
    for (const where of ['start', 'prev', 'next', 'end', 'nonsense']) {
      expect(TL.step([], at('2026-11-22'), where)).toBeNull()
    }
  })
})

describe('the ruler the page draws', () => {
  test('it is one row from birth to 40 years past today', () => {
    expect(page).toContain('TL.endYear = now.getFullYear() + 40;')
    expect(page).not.toContain('BIRTH.getFullYear() + 100')     // the old 100-year tail
  })

  test('±2 years around today are rendered by month', () => {
    expect(page).toContain('new Date(now.getFullYear() - 2, now.getMonth(), 1)')
    expect(page).toContain('new Date(now.getFullYear() + 2, now.getMonth() + 1, 0)')
    expect(page).toContain('tick(d, "m",')
  })

  test('future ticks are coloured by the annual risk at that age', () => {
    // both places the ruler draws a tick: the yearly loop and the monthly helper. The count is the
    // guard — a future tick painted in only one of them leaves the other half of the horizon grey.
    expect(page.match(/riskColour\(annualRisk\(ageAt\(d\)\)\)/g)?.length).toBe(2)
  })

  test('a click anywhere on the strip selects that date', () => {
    // one path for every date change: the projection and the marker cannot disagree
    expect(page).toContain('document.getElementById("tl").addEventListener("pointerdown"')
    expect(page).toContain('selectDate(d)')
    expect(page).not.toContain('state.date = iso(d); paintFade(); refreshPick();')
  })

  test('no wheel scroll on the strip', () => {
    expect(page).toMatch(/getElementById\("tl"\)\.addEventListener\("wheel", e => \{ e\.preventDefault\(\); \}, \{ passive: false \}\)/)
    expect(page).toContain('pointer-events:auto; overflow:hidden;')
  })
})

describe('the player in the main view header', () => {
  test('four buttons, in the order the wireframe drew them: start, prev, next, end', () => {
    const steps = [...page.matchAll(/<button data-step="([a-z]+)"/g)].map((m) => m[1])
    expect(steps).toEqual(['start', 'prev', 'next', 'end'])
  })

  test('widget 6 sits at the centre column top-right, not in the page bar', () => {
    // v11 draws the four buttons inside the main view's own header, right of the subject line; the
    // page's top bar is the app's chrome and carries the graph button and the profile only.
    const bar = page.slice(page.indexOf('<div class="bar">'), page.indexOf('<div id="leftCol">'))
    expect(bar).not.toContain('id="tlPlayer"')
    expect(bar).not.toContain('id="tlDate"')

    const head = page.slice(page.indexOf('<section id="main"'), page.indexOf('id="mainBody"'))
    expect(head).toContain('id="tlPlayer"')
    expect(head).toContain('id="tlDate"')
    // the header reads left to right: the subject line, then the right-hand cluster — the date, the
    // four buttons — and the centre's own collapse control at the edge (SCRUM-66: a column
    // collapses, so the centre carries ‹collapse› there instead of an ✕ that closed it)
    expect(head.indexOf('id="mainKicker"')).toBeLessThan(head.indexOf('id="tlDate"'))
    expect(head.indexOf('id="tlDate"')).toBeLessThan(head.indexOf('id="tlPlayer"'))
    expect(head.indexOf('id="tlPlayer"')).toBeLessThan(head.indexOf('id="collapseCentre"'))
    expect(head).not.toContain('id="mainClose"')
  })

  test('the column keeps its header, and the player with it, when the date has no record', () => {
    // a click on the ruler selects a bare day. The navigator must not vanish under the reader's hand,
    // so the box collapses to its header instead of closing; nothing is drawn in the empty body.
    expect(page).toContain('box.classList.add("bare")')
    expect(page).toContain('#main.bare .mbody, #main.bare #mainClose')
    expect(page).not.toContain('if (!row || state.mainHidden) { box.hidden = true; return; }')
  })

  test('a step opens the event it lands on, not just the day', () => {
    // stopping on a date and then being told there is no record there would be a lie about the click
    expect(page).toContain('const hit = ANALYSES.find(a => +a.at === at)')
    expect(page).toContain('selectDate(new Date(at), hit ? hit.id : null)')
  })

  test('the step maths is the tested module, not a second copy in the page', () => {
    expect(page).toContain('<script src="lib/timeline-step.js"></script>')
    expect(page).toContain('TimelineStep.step(times, from, where)')
    expect(page).not.toContain('where === "prev"')     // no inline verb handling beside the module
  })

  test('the date the player stands on is shown, so a step is visible', () => {
    expect(page).toContain('id="tlDate"')
    expect(page).toContain('function tlReadout()')
  })
})
