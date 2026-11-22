import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { validateKg } from './lib/kg-contract'

/**
 * SCRUM-47 — the right panel for a past record.
 *
 * The card's acceptance, as data:
 *   - past record: solid "then" and paled "now" for forecast and recommendations, on one screen
 *     at one scale;
 *   - today's record: one solid state, no paled row;
 *   - the delta in words, naming the record that moved it;
 *   - both states carry the same sections in the same order; only the values and the weight
 *     differ.
 *
 * `body/lib/right-panel.js` holds the rules; the page is checked separately for the DOM that
 * spends them (`body/index.html`: `.rpcol` solid/paled classes, `rpdelta` words).
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

type Source = { label: string; link: string }
type Cell = {
  delta?: number
  date?: string
  status?: string
  advisedOn?: string
  by?: string
  source?: Source
} | null
type Row = { key: string; label: string; then: Cell; now: Cell }
type Forecast = { available: boolean; years: number | null; records: number; drivers: Array<{ track: string; label: string; date: string; delta: number }> }
type Panel = {
  past: boolean
  asOf: string
  today: string
  states: Array<{ key: string; label: string; date: string; solid: boolean }>
  order: Array<{ key: string; n: number; title: string }>
  empty: boolean
  sections: {
    forecast: { then: Forecast; now: Forecast; delta: { total: string; because: string }; note: string }
    moves: { rows: Row[] }
    recommended: { rows: Row[] }
    unknown: { rows: Row[] }
    grounds: { rows: Row[] }
  }
}
type RightPanel = {
  build: (input: Record<string, unknown>) => Panel
  forecastAt: (nodes: Node[], asOf: string, leBySex: Record<string, number>, sex: string) => Forecast
  ORDER: Array<{ key: string; n: number; title: string }>
}

const sandbox: { RightPanel?: RightPanel } = {}
vm.createContext(sandbox)
vm.runInContext(read('body/lib/right-panel.js'), sandbox)
const RP = sandbox.RightPanel as RightPanel

const TODAY = '2026-11-22'
const PAST = '2015-01-01'
const LE = { male: 74, female: 80 }

const doc = (id: string, label: string, when: string, link = '') => ({ id, kind: 'document', label, when, link })
const NODES: Record<string, unknown>[] = [
  doc('doc-gp-2012', 'Family practice visit, 14 Mar 2012', '2012-03-14', 'sources/gp-2012.pdf'),
  doc('doc-gp-2016', 'Family practice visit, 20 Sep 2016', '2016-09-20', 'sources/gp-2016.pdf'),
  doc('doc-cardio-2026', 'Cardiology visit, 19 Nov 2026', '2026-11-19', 'sources/cardio-2026.pdf'),
  { id: 'enc-gp-2012', kind: 'encounter', label: 'Family practice visit', when: '2012-03-14', source: 'doc-gp-2012' },
  { id: 'enc-gp-2016', kind: 'encounter', label: 'Family practice visit', when: '2016-09-20', source: 'doc-gp-2016' },
  { id: 'enc-cardio-2026', kind: 'encounter', label: 'Cardiology visit', when: '2026-11-19', source: 'doc-cardio-2026' },
  { id: 'med-amlodipine', kind: 'medication', label: 'Amlodipine 5 mg', when: { from: '2012-04-02' }, source: 'doc-gp-2012' },
  { id: 'med-statin', kind: 'medication', label: 'Atorvastatin 20 mg', when: { from: '2016-10-11', to: '2024-01-01' }, source: 'doc-gp-2016', delta: 3.6 },
  { id: 'med-new', kind: 'medication', label: 'Empagliflozin 10 mg', when: { from: '2026-11-19' }, source: 'doc-cardio-2026' },
  { id: 'obs-lipid-2019', kind: 'observation', label: 'Lipid panel', when: '2019-05-20', track: 'lipids', delta: 1.2, value: 5.9, unit: 'mmol/L' },
  { id: 'obs-lipid-2026', kind: 'observation', label: 'Lipid panel', when: '2026-11-19', track: 'lipids', delta: 0.6, value: 4.1, unit: 'mmol/L' },
  { id: 'obs-bp-2012', kind: 'observation', label: 'Blood pressure', when: '2012-03-14', track: 'bp', delta: -1.0, value: 158 },
  { id: 'obs-egfr-2026', kind: 'observation', label: 'eGFR', when: '2026-11-19', track: 'egfr', delta: 0.4, value: 82 }
]
const EDGES = [
  { from: 'enc-gp-2012', to: 'med-amlodipine', label: 'advised' },
  { from: 'enc-gp-2016', to: 'med-statin', label: 'advised' },
  { from: 'enc-cardio-2026', to: 'med-new', label: 'advised' },
  { from: 'enc-cardio-2026', to: 'obs-egfr-2026', label: 'advised' }
]

const INPUT = {
  nodes: NODES,
  edges: EDGES,
  date: PAST,
  today: TODAY,
  leBySex: LE,
  sex: 'male'
}

const todayInput = { ...INPUT, date: TODAY }

describe('a past record: then solid, now paled', () => {
  const panel = RP.build(INPUT)

  test('two states, one screen: then solid, now paled', () => {
    expect(panel.past).toBe(true)
    expect(panel.states.map((s) => s.key)).toEqual(['then', 'now'])
    expect(panel.states[0].solid).toBe(true)
    expect(panel.states[1].solid).toBe(false)
    expect(panel.states[0].date).toBe(PAST)
    expect(panel.states[1].date).toBe(TODAY)
  })

  test('both states use the same five sections in the same order', () => {
    expect(panel.order.map((s) => s.key)).toEqual(['forecast', 'moves', 'recommended', 'unknown', 'grounds'])
    expect(panel.order.map((s) => s.n)).toEqual([20, 21, 22, 23, 24])
  })

  test('then\'s forecast is the date\'s knowledge, not today\'s', () => {
    const { then, now } = panel.sections.forecast
    // only the 2012 blood pressure exists by 2015; the statin, the lipid panel and eGFR are later
    expect(then.years).toBeCloseTo(74 - 1.0, 6)
    expect(then.records).toBe(1)
    expect(then.drivers.map((d) => d.date)).toEqual(['2012-03-14'])
    // now the newest lipid reading, the statin's own effect and eGFR are all in the estimate
    expect(now.years).toBeCloseTo(74 + 0.6 + 3.6 - 1.0 + 0.4, 6)
    expect(now.records).toBe(4)
  })

  test('the two forecasts are on one scale: years', () => {
    const { then, now } = panel.sections.forecast
    expect(typeof then.years).toBe('number')
    expect(typeof now.years).toBe('number')
    // no interval is invented: the document publishes none for this baseline
    expect(panel.sections.forecast).not.toHaveProperty('interval')
    expect(panel.sections.forecast.note).toContain('no interval')
  })

  test('the delta is in words and names the records that moved it', () => {
    const { delta } = panel.sections.forecast
    expect(delta.total).toBe('+4.6 years since 2015-01-01')
    expect(delta.because).toBe(
      '+3.6 of it \u2014 Atorvastatin 20 mg (2016-10-11) \u00b7 ' +
      '+0.6 of it \u2014 Lipid panel (2026-11-19) \u00b7 ' +
      '+0.4 of it \u2014 eGFR (2026-11-19)'
    )
  })

  test('what moves it: aligned by track, a then value and a now value per row', () => {
    const rows = panel.sections.moves.rows
    const bp = rows.find((r) => r.key === 'bp')
    expect(bp?.then).toEqual({ delta: -1.0, date: '2012-03-14' })
    expect(bp?.now).toEqual({ delta: -1.0, date: '2012-03-14' })
    const lipids = rows.find((r) => r.key === 'lipids')
    expect(lipids?.then).toBeNull()          // did not exist on the selected date
    expect(lipids?.now?.delta).toBe(0.6)
    // a drug's explicit effect moves the forecast too, which is how a recommendation is credited
    const statin = rows.find((r) => r.key === 'med-statin')
    expect(statin?.then).toBeNull()
    expect(statin?.now).toEqual({ delta: 3.6, date: '2016-10-11' })
  })

  test('recommended: status at that time, and status now, with the source', () => {
    const amlodipine = panel.sections.recommended.rows.find((r) => r.key === 'med-amlodipine')
    expect(amlodipine?.then?.status).toBe('since 2012-04-02')
    expect(amlodipine?.then?.source?.label).toBe('Family practice visit, 14 Mar 2012')
    expect(amlodipine?.then?.source?.link).toBe('sources/gp-2012.pdf')

    const statin = panel.sections.recommended.rows.find((r) => r.key === 'med-statin')
    expect(statin?.then).toBeNull()          // advised in 2016, after the selected date
    expect(statin?.now?.status).toBe('stopped 2024-01-01')
    expect(statin?.now?.source?.label).toBe('Family practice visit, 20 Sep 2016')

    const empagliflozin = panel.sections.recommended.rows.find((r) => r.key === 'med-new')
    expect(empagliflozin?.then).toBeNull()  // not advised yet on the selected date
    expect(empagliflozin?.now?.status).toBe('since 2026-11-19')
  })

  test('what we do not know carries both states; a closed gap says so now', () => {
    const rows = panel.sections.unknown.rows
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => {
      expect(row).toHaveProperty('then')
      expect(row).toHaveProperty('now')
    })
    const smoking = rows.find((r) => r.key === 'smoking')
    expect(smoking?.then).toEqual({ known: false, text: 'missing' })
    expect(smoking?.now).toEqual({ known: false, text: 'missing' })
  })

  test('on what grounds: same rows, the record count differs', () => {
    const records = panel.sections.grounds.rows.find((r) => r.key === 'records')
    expect(records?.then).not.toBe(records?.now)
    expect(records?.then).toContain('1 record')
    expect(records?.now).toContain('4 records')
  })
})

describe("today's record: one solid state", () => {
  const panel = RP.build(todayInput)

  test('no paled row, one state', () => {
    expect(panel.past).toBe(false)
    expect(panel.states).toHaveLength(1)
    expect(panel.states[0].solid).toBe(true)
    expect(panel.states[0].date).toBe(TODAY)
  })

  test('then and now are the same state; no delta is printed', () => {
    expect(panel.sections.forecast.then.years).toBe(panel.sections.forecast.now.years)
    expect(panel.sections.forecast.delta.total).toBe('')
    expect(panel.sections.forecast.delta.because).toBe('')
    panel.sections.moves.rows.forEach((row) => {
      expect(row.then).toEqual(row.now)
    })
  })
})

describe('the refusals', () => {
  test('no records at all is "not enough data", not a number', () => {
    const panel = RP.build({ nodes: [], edges: [], date: TODAY, today: TODAY, leBySex: LE, sex: 'male' })
    expect(panel.empty).toBe(true)
    expect(panel.sections.forecast.then.available).toBe(false)
    expect(panel.sections.forecast.then.years).toBeNull()
  })

  test('a selected date before the first record has no then forecast, and says why', () => {
    const panel = RP.build({ ...INPUT, date: '2010-01-01' })
    expect(panel.sections.forecast.then.available).toBe(false)
    expect(panel.sections.forecast.then.years).toBeNull()
    expect(panel.sections.forecast.delta.total).toContain('cannot compare')
    expect(panel.sections.forecast.now.available).toBe(true)
  })

  test('a record without a date cannot move an estimate at a date', () => {
    const panel = RP.build({
      ...INPUT,
      nodes: [...NODES, { id: 'obs-undated', kind: 'observation', label: 'Undated', track: 'x', delta: 2 }]
    })
    expect(panel.sections.moves.rows.some((r) => r.key === 'x')).toBe(false)
  })
})

describe('the screenshot fixture: a real document that can move the forecast', () => {
  const fixture = JSON.parse(read('tests/fixtures/page/then-now.json')) as {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    meta: Record<string, unknown>
  }

  test('it is a kg/1-health document the contract accepts', () => {
    expect(validateKg(fixture)).toEqual([])
  })

  test('the past record on it shows the card\'s example: a statin recommended then, credited now', () => {
    const panel = RP.build({
      nodes: fixture.nodes,
      edges: fixture.edges,
      date: '2021-05-14',
      today: TODAY,
      leBySex: LE,
      sex: 'male'
    })
    expect(panel.past).toBe(true)
    expect(panel.sections.forecast.delta.total).toBe('+2.2 years since 2021-05-14')
    expect(panel.sections.forecast.delta.because).toContain('Atorvastatin 20 mg (2026-08-19)')
    const statin = panel.sections.recommended.rows.find((r) => r.key === 'med-atorvastatin')
    expect(statin?.then?.status).toBe('not started yet')
    expect(statin?.now?.status).toBe('since 2026-08-19')
    expect(statin?.then?.source?.label).toBe('Discharge note, cardiology, p.2')
  })
})

describe('the page spends the model, and the rejected ghost is gone', () => {
  const page = read('body/index.html')

  test('the panel is in the product view and hidden in the graph view', () => {
    expect(page).toContain('id="rightCol" class="only-main"')
    expect(page).toContain('lib/right-panel.js')
    expect(page).toContain('renderRightPanel()')
  })

  test('two states are drawn by weight: solid then, paled now', () => {
    expect(page).toContain('.rpcol.now')
    expect(page).toContain('opacity:.42')
    expect(page).toContain('rpdelta')
    // the v12 ghost's honest-but-wrong label does not survive the correction
    expect(page).not.toContain("these are today's numbers")
  })

  test('the panel follows the same date as the main view', () => {
    const refresh = page.slice(page.indexOf('function refreshPick'), page.indexOf('function refreshPick') + 900)
    expect(refresh).toContain('renderRightPanel()')
  })
})
