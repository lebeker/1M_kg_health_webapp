import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
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
  delta?: number | null
  date?: string
  value?: string
  source?: Source
  status?: string
  advisedOn?: string
  by?: string
} | null
type Row = { key: string; label: string; value?: string; then: Cell; now: Cell }
type GapRow = { key: string; text: string; then: { known: boolean; text: string }; now: { known: boolean; text: string } }
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
    moves: { rows: Row[]; note: string }
    recommended: { rows: Row[] }
    unknown: { rows: GapRow[] }
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

  test('what moves it: the factors, aligned by factor, a then value and a now value per row', () => {
    const rows = panel.sections.moves.rows
    const bp = rows.find((r) => r.key === 'blood-pressure')
    expect(bp?.then?.delta).toBe(-1.0)
    expect(bp?.then?.date).toBe('2012-03-14')
    expect(bp?.then?.value).toBe('158')
    expect(bp?.now?.delta).toBe(-1.0)
    // a lipid panel with no LDL marker is not an LDL row, but it does record an effect, so it is
    // still explained — by its own row, because it moved the number
    const lipids = rows.find((r) => r.key === 'effect:lipids')
    expect(lipids?.then).toBeNull()          // did not exist on the selected date
    expect(lipids?.now?.delta).toBe(0.6)
    // a drug's explicit effect moves the forecast too, which is how a recommendation is credited
    const statin = rows.find((r) => r.key === 'statin')
    expect(statin?.then).toBeNull()
    expect(statin?.now?.delta).toBe(3.6)
    expect(statin?.now?.date).toBe('2016-10-11')
  })

  test('a record that records no effect is not a row: +0.0 is not "nothing", it is "no number"', () => {
    // the synthetic document's own lipid panel and eGFR record effects; nothing records zero
    const rows = panel.sections.moves.rows
    expect(rows.every((r) => r.then?.delta !== 0 && r.now?.delta !== 0)).toBe(true)
    // and a record with neither `delta` nor `evidence` never becomes one
    const withNeutral = RP.build({
      ...INPUT,
      nodes: [
        ...NODES,
        { id: 'obs-alt-2014', kind: 'observation', label: 'ALT', when: '2014-06-01', track: 'liver', value: 62 }
      ]
    })
    expect(withNeutral.sections.moves.rows.some((r) => r.key === 'effect:liver')).toBe(false)
    expect(withNeutral.sections.moves.rows.some((r) => r.label === 'ALT')).toBe(false)
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

describe('the owner\'s audit: what moves it names factors, not lab panels (2026-11-22)', () => {
  const demo = JSON.parse(read('kg_demo.json')) as {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    meta: Record<string, unknown>
  }
  const panel = RP.build({
    nodes: demo.nodes,
    edges: demo.edges,
    date: '2026-11-22',
    today: '2026-11-22',
    leBySex: { male: 74, female: 80 },
    sex: 'male',
    meta: demo.meta
  })
  const rows = panel.sections.moves.rows

  test('the rows are the factors the owner named, and a lab panel is not one of them', () => {
    expect(rows.map((r) => r.key)).toEqual(['ldl', 'age', 'blood-pressure', 'statin'])
    // the defect: ALT, blood count, HbA1c and fasting glucose were listed, at +0.0
    const analyses = /^(ALT|Blood count|HbA1c|Fasting glucose|eGFR|Troponin)/i
    rows.forEach((row) => expect(analyses.test(row.label)).toBe(false))
  })

  test('no row prints +0.0: an unweighed record shows no number, not a zero', () => {
    rows.forEach((row) => {
      expect(row.now?.delta ?? null).toBeNull()
      expect(row.then?.delta ?? null).toBeNull()
    })
  })

  test('each row carries what the document says and the record it says it in', () => {
    const by = (key: string) => rows.find((r) => r.key === key)
    expect(by('ldl')?.value).toBe('3.6 mmol/L')
    expect(by('ldl')?.now?.source?.link).toBe('sources/cardio-note-2026-11-19.pdf')
    expect(by('blood-pressure')?.value).toBe('149/90 mm[Hg]')
    expect(by('blood-pressure')?.now?.source?.link).toBe('sources/bp-diary-2025-11.pdf')
    expect(by('age')?.value).toBe('65')
    expect(by('statin')?.value).toBe('since 2016-10-11')
    expect(by('statin')?.now?.source?.link).toBe('sources/gp-note-2016-09-20.pdf')
  })

  test('and the section says why nothing weighs instead of letting dashes mean "nothing matters"', () => {
    expect(panel.sections.moves.note).toContain('no record here carries an effect size')
  })

  test('the sixth factor, steps, is named as a gap: a document carries no activity record', () => {
    const steps = panel.sections.unknown.rows.find((r) => r.key === 'steps')
    expect(steps?.then?.known).toBe(false)
    expect(steps?.text).toContain('no step count')
  })

  test('a factor is read at the selected date: the then column shows the age and the value of that day', () => {
    const past = RP.build({
      nodes: demo.nodes,
      edges: demo.edges,
      date: '2021-03-30',
      today: '2026-11-22',
      leBySex: { male: 74, female: 80 },
      sex: 'male',
      meta: demo.meta
    })
    const age = past.sections.moves.rows.find((r) => r.key === 'age')
    expect(age?.then?.value).toBe('60')
    expect(age?.now?.value).toBe('65')
    const ldl = past.sections.moves.rows.find((r) => r.key === 'ldl')
    expect(ldl?.then?.value).toBe('3.2 mmol/L')   // the 2019 panel, the newest by then
    expect(ldl?.now?.value).toBe('3.6 mmol/L')
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

  test('a row that moves the number carries the record it came from, with its link', () => {
    const panel = RP.build({
      nodes: fixture.nodes,
      edges: fixture.edges,
      date: '2021-05-14',
      today: TODAY,
      leBySex: LE,
      sex: 'male'
    })
    const statin = panel.sections.moves.rows.find((r) => r.key === 'statin')
    expect(statin?.now?.source?.label).toBe('Discharge note, cardiology, p.2')
    expect(statin?.now?.source?.link).toBe('sources/discharge-2021-05-14.pdf')
    const ldl = panel.sections.moves.rows.find((r) => r.key === 'ldl')
    expect(ldl?.now?.value).toBe('4.9 mmol/L')
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

  test('a factor row draws the number, the factor and its source in each half, a dash for no effect', () => {
    expect(page).toContain('state.delta == null ? "\\u2014" : rpSigned(state.delta)')
    expect(page).toContain('function rpFactorCell(row, state, key)')
    expect(page).toContain('linkEl(source.label')
    // an empty half keeps the factor's name instead of a bare dash
    expect(page).toContain('not recorded on this date')
  })

  test('the panel follows the same date as the main view', () => {
    const refresh = page.slice(page.indexOf('function refreshPick'), page.indexOf('function refreshPick') + 900)
    expect(refresh).toContain('renderRightPanel()')
  })
})

/**
 * The reopen (supervisor, 2026-11-22): "the third column landed with the right content but the page
 * draws it floating to the right of an empty centre. Reopen: three columns side by side, centre
 * filled, on open." These are the page's own invariants for that, in the only form a unit gate can
 * hold them: the columns' edges come from one pair of numbers, the centre is filled on the record
 * the page opens on, and a closed centre does not leave the panel stranded.
 */
describe('three columns side by side (docs/wireframe-health-v13-past-compared.svg)', () => {
  const page = read('body/index.html')
  const style = page.slice(page.indexOf('<style>'), page.indexOf('</style>'))

  test('the panel width is one variable, and the centre stops where the panel starts', () => {
    expect(style).toContain('--panelw:592px')
    expect(style).toContain('--colgap:12px')
    expect(style).toContain('width:var(--panelw)')
    expect(style).toContain('right:calc(var(--panelw) + var(--colgap) * 2)')
    // the old fixed panel: a width that knew nothing about the centre
    expect(style).not.toContain('right:404px')
    expect(style).not.toContain('width:380px')
  })

  test('a narrower window shrinks the panel before it hides it', () => {
    expect(style).toContain('@media (max-width:1560px) { :root { --panelw:460px; } }')
    expect(style).toContain('@media (max-width:1180px)')
  })

  test('closing the centre lets the panel take its place instead of floating', () => {
    expect(style).toContain('body.centre-closed #rightCol')
    expect(page).toContain('classList.toggle("centre-closed"')
  })

  test('the page opens on its latest item, so the centre is filled without a click', () => {
    // the latest item is the list's first row: today's summary, generated at launch
    expect(page).toContain('openLatest();')
    expect(page).toContain('const latest = STATE_ROWS[0];')
    expect(page).toContain('selectDate(dayOf(latest.date), latest.id)')
    // and the row the list marks is the row the centre draws — one rule, both halves
    expect(page).toContain('const row = currentRow();')
  })

  test('every block is the same two-track grid: then is the left half, now the right', () => {
    expect(style).toContain('.rpsec .rpcmp, .rphead, .rprow { display:grid;')
    expect(style).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr)')
    expect(style).toContain('.rpsec[data-one="yes"]')
    expect(page).toContain('function rpHead(section, panel)')
    expect(page).toContain('panel.past ? "then \\u00b7 " + panel.asOf : "today \\u00b7 " + panel.asOf')
  })

  test('the geometry is reported as data, so a run can check it without reading the CSS', () => {
    expect(page).toContain('window.__columns = () =>')
    expect(page).toContain('centreFilled:')
  })
})

describe('the card names its wireframe by path', () => {
  const widgets = read('docs/WIDGETS.md')
  test('v13-past-compared is the drawing the past record is implemented against', () => {
    expect(widgets).toContain('`wireframe-health-v13-past-compared.svg`')
    expect(existsSync(new URL('../docs/wireframe-health-v13-past-compared.svg', import.meta.url))).toBe(true)
  })

  test('the superseded drawing is gone, so nobody implements it', () => {
    expect(existsSync(new URL('../docs/wireframe-health-v13-past-then-now.svg', import.meta.url))).toBe(false)
    expect(widgets).not.toContain('wireframe-health-v13-past-then-now.svg')
  })

  test('the rule that every UI card names its wireframe is written down', () => {
    expect(widgets).toContain('Every UI card names the exact wireframe file(s) it implements, by path')
    expect(read('docs/DELIVERY-LOOP.md')).toContain('A UI card is written against a wireframe')
  })
})
