import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * T10 — the left panel answers "what was known then".
 *
 * The card's behaviour lives in two places and both are pinned here:
 *   1. `body/lib/state-list.js` — which rows exist, how they are ordered, what the annual marker
 *      and the today row are. Pure, so the rules read as dates instead of clicks.
 *   2. `body/index.html` — the list's markup, the selected-row marker and the click that centres
 *      a row. The dynamic half — the browser run proving the ruler moves and the row centres — is
 *      the acceptance evidence on the card; these checks fail when the code stops expressing the
 *      rule, which is what a unit gate is for.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')

type Row = { id: string; kind: string; date: string; title: string; note: string; stored: boolean }
type StateList = {
  rows: (nodes: Array<Record<string, unknown>>, today: string) => Row[]
  events: (nodes: Array<Record<string, unknown>>) => Row[]
  annual: (list: Row[], today: string) => Row[]
  day: (value: unknown) => string
}
const sandbox: { StateList?: StateList } = {}
vm.createContext(sandbox)
vm.runInContext(read('body/lib/state-list.js'), sandbox)
const SL = sandbox.StateList as StateList

const TODAY = '2026-11-22'

const NODES = [
  { id: 'lab-2019', kind: 'analysis', label: 'TSH 6.8', date: '2019-04-12' },
  { id: 'dx-2024', kind: 'condition', label: 'hypertension', date: '2024-10-22' },
  { id: 'dec-2024', kind: 'decision', label: 'home BP diary', date: '2024-10-25' },
  { id: 'obs-2026', kind: 'observation', label: 'BP 150/110', when: '2026-10-15' },
  { id: 'plan-2026', kind: 'prediction', label: 'repeat BP check', date: '2026-12-01' },
  { id: 'source-1', kind: 'source', label: 'a scan', date: '2019-04-12' }
]

const dates = (rows: Row[]) => rows.map((r) => r.date)
const kinds = (rows: Row[]) => rows.map((r) => r.kind)

describe('one list, newest on top', () => {
  test('the today summary is the first row, even with a future record above every past one', () => {
    const rows = SL.rows(NODES, TODAY)
    expect(rows[0].kind).toBe('today')
    expect(rows[0].date).toBe(TODAY)
    expect(rows[0].stored).toBe(false)
  })

  test('everything else is sorted newest first: the future sits above the past', () => {
    const rest = SL.rows(NODES, TODAY).slice(1)
    expect(dates(rest)).toEqual([...dates(rest)].sort().reverse())
    expect(rest[0].date).toBe('2026-12-01')          // the planned check is the newest
    expect(rest[rest.length - 1].date).toBe('2019-04-12')
    expect(rest.findIndex((r) => r.date === '2026-12-01'))
      .toBeLessThan(rest.findIndex((r) => r.date === '2026-10-15'))
  })

  test('there are no FUTURE/PAST captions — a caption would be a second list', () => {
    const rows = SL.rows(NODES, TODAY)
    expect(rows.every((r) => r.kind !== 'caption')).toBe(true)
    expect(rows.every((r) => !/^(FUTURE|PAST)$/.test(r.title))).toBe(true)
    expect(page).not.toMatch(/>\s*(FUTURE|PAST)\s*</)
  })

  test('two records on one day are two rows; the order between them is the document order', () => {
    const rows = SL.rows(
      [
        { id: 'a', kind: 'analysis', label: 'first', date: '2024-10-22' },
        { id: 'b', kind: 'decision', label: 'second', date: '2024-10-22' }
      ],
      TODAY
    )
    expect(rows.slice(1).filter((r) => r.kind !== 'summary').map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('the list mixes records, not one kind of them', () => {
  test('analyses, diagnoses and decisions each carry their own name', () => {
    const rows = SL.rows(NODES, TODAY)
    expect(kinds(rows)).toContain('analysis')
    expect(kinds(rows)).toContain('diagnosis')
    expect(kinds(rows)).toContain('decision')
    expect(kinds(rows)).toContain('summary')
    expect(kinds(rows)).toContain('projected')
  })

  test('a row of every kind, and a document kind the list does not know is not a row', () => {
    expect(SL.events([{ id: 'x', kind: 'wormhole', label: 'nope', date: '2020-01-01' }])).toEqual([])
    expect(SL.events([{ id: 'y', kind: 'analysis', label: 'no date' }])).toEqual([])
  })

  test('a source document is provenance, not a record', () => {
    expect(SL.events(NODES).every((r) => r.id !== 'source-1')).toBe(true)
  })

  test('an interval record stands on its own start day', () => {
    expect(SL.events([{ id: 'm', kind: 'medication', label: 'statin',
                        when: { from: '2026-08-19', to: null } }])[0].date).toBe('2026-08-19')
  })
})

describe('the annual summary is a marker, not an event', () => {
  test('it is stamped 01-01 of the year after the one it covers', () => {
    const annual = SL.annual(SL.events(NODES), TODAY)
    expect(annual.map((r) => r.date)).toEqual(['2020-01-01', '2025-01-01'])
    expect(annual.every((r) => r.stored === false)).toBe(true)
  })

  test('a year that has not ended has nothing to summarise yet', () => {
    const annual = SL.annual(SL.events(NODES), TODAY)
    expect(annual.some((r) => r.date === '2027-01-01')).toBe(false)   // 2026 is still running
  })

  test('a summary the document stored itself wins over the generated marker', () => {
    const withStored = NODES.concat([
      { id: 'annual-2024', kind: 'summary', label: '2024: two records', date: '2025-01-01' }
    ])
    const rows = SL.rows(withStored, TODAY)
    const onStamp = rows.filter((r) => r.date === '2025-01-01')
    expect(onStamp.length).toBe(1)
    expect(onStamp[0].stored).toBe(true)
  })

  test('the marker counts the year it covers, not itself', () => {
    const byYear = SL.rows(NODES, TODAY).find((r) => r.id === 'annual:2024')
    expect(byYear?.note).toBe('2024: 2 records')
  })
})

describe('the today summary is generated at launch and never stored', () => {
  test('it is not one of the document events', () => {
    expect(SL.events(NODES).some((r) => r.id === 'today')).toBe(false)
    expect(SL.rows(NODES, TODAY).filter((r) => r.id === 'today').length).toBe(1)
  })

  test('it counts what is behind today and what is still ahead', () => {
    const row = SL.rows(NODES, TODAY)[0]
    expect(row.note).toBe('4 records · latest 2026-10-15 · 1 ahead')
  })

  test('an empty document still has an honest today row, not an invented count', () => {
    const rows = SL.rows([], TODAY)
    expect(rows.length).toBe(1)
    expect(rows[0].note).toBe('nothing recorded yet')
  })
})

describe('the panel the page draws', () => {
  test('the list is the left column and reads the whole document, not only the analyses', () => {
    expect(page).toContain('id="stateRows"')
    expect(page).toContain('StateList.rows(DOC_NODES, iso(new Date()))')
    expect(page).toContain('id="leftCol"')
  })

  test('the today row is made at launch, in the page, not written anywhere', () => {
    expect(page).toContain('buildStateList();       // today\'s summary is made here, at launch')
    expect(page).not.toContain('localStorage.setItem')
  })

  test('the selected row is the only marker — one class, no second widget', () => {
    expect(page).toContain('el.classList.toggle("on", hit)')
    expect(page).toContain('.srow.on')
  })

  test('clicking a row centres it and moves the timeline to its day', () => {
    expect(page).toContain('selectDate(dayOf(row.date), row.id)')
    expect(page).toContain('centreRow(el)')
    expect(page).toContain('box.scrollTop += (r.top - b.top) - (b.height - r.height) / 2')
  })
})
