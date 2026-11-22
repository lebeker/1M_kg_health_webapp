import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * T11 — the main view answers "the selected event, in full".
 *
 * The card's behaviour lives in two places and both are pinned here:
 *   1. `body/lib/main-view.js` — which of the three views an event opens, what a marker row is,
 *      what a warning means, what belongs to a note, and what a summary may and may not say.
 *   2. `body/index.html` — the one centre container, the four marks, and the fact that a summary
 *      draws no links and no assignments. The dynamic half (the browser run on the demo, one
 *      screenshot per view) is the acceptance evidence on the card; these checks fail when the
 *      code stops expressing the rule, which is what a unit gate is for.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('body/index.html')

type Row = { id: string; kind: string; date: string; title: string; note: string; stored: boolean }
type Node = Record<string, unknown>
type Edge = Record<string, unknown>
type Context = { nodes?: Node[]; edges?: Edge[]; byId?: (id: unknown) => Node | null; today?: string }

type Marker = { name: string; value: number; unit: string; ref: [number | null, number | null] | null; reference: string; flag: string; from: string; out: boolean }
type Assignment = { id: string; label: string; detail: string; date: string; tone: string; why: string; confirmed: boolean }
type Summary = { generated: boolean; period: string; planned: string[]; done: string[]; held: string[]; dropped: string[]; note: string }
type MainView = {
  viewOf: (row: Row | null, node: Node | null) => string
  markers: (node: Node | null) => Marker[]
  sourceOf: (node: Node | null, byId: (id: unknown) => Node | null) => {
    lab: string; address: string; link: string; gaps: string[]
    document: { id: string; label: string; link: string; confirmed: boolean } | null
  }
  meaning: (node: Node | null) => string
  verdict: (node: Node | null, ctx: Context) => {
    official: boolean; generated: boolean; badge: string; text: string
    doctor: string; clinic: string; links: Array<{ href: string; title: string }>
    warning: string; why: string[]; contradicted: Array<{ id: string; date: string }>
  }
  isOfficial: (node: Node | null) => boolean
  isRealDiagnosis: (node: Node | null) => boolean
  toneOf: (item: Node, realDiagnosis: boolean) => { icon: string; why: string }
  assignments: (node: Node | null, ctx: Context) => Record<string, Assignment[]>
  summaryOf: (row: Row | null, node: Node | null, ctx: Context) => Summary
  linked: (node: Node | null, ctx: Context) => Array<{ id: string; rel: string; date: string }>
  groups: string[]
}
const sandbox: { MainView?: MainView } = {}
vm.createContext(sandbox)
vm.runInContext(read('body/lib/main-view.js'), sandbox)
const MV = sandbox.MainView as MainView

const TODAY = '2026-11-22'

const NODES: Node[] = [
  {
    id: 'doc-lipid',
    kind: 'document',
    label: 'Lipid panel — City Lab',
    date: '2026-11-12',
    confirmed: true,
    lab: 'City Lab',
    address: '12 Shevchenka St, Kyiv',
    link: 'sources/lipid.pdf'
  },
  {
    id: 'lipid',
    kind: 'analysis',
    label: 'Lipid panel',
    date: '2026-11-12',
    panel: 'lipid',
    source: 'doc-lipid',
    confirmed: true,
    values: [
      { name: 'LDL', value: 4.2, unit: 'mmol/l', ref: [0, 3.0], flag: 'high', code: '2089-1' },
      { name: 'HDL', value: 1.1, unit: 'mmol/l', ref: [1.0, 1.5] },
      { name: 'Triglycerides', value: 2.4, unit: 'mmol/l', ref: [0.4, 1.7] },
      null // a value that is not a number is not a row
    ],
    summary: 'LDL is the number that builds plaque.'
  },
  { id: 'single', kind: 'observation', label: 'Glucose', when: '2024-11-07', value: 4.94, unit: 'mmol/l', ref_low: 4.11, ref_high: 5.89 },
  {
    id: 'dx-doctor',
    kind: 'condition',
    label: 'hyperlipidaemia',
    date: '2026-11-19',
    status: 'active',
    origin: 'doctor',
    confirmed: true,
    source: 'doc-lipid',
    doctor: { name: 'Dr Anya Kovalenko', specialty: 'cardiologist' },
    clinic: { name: 'City Clinic', address: '12 Shevchenka St, Kyiv' },
    link: 'sources/note.pdf',
    text: 'Start a statin, repeat the panel in three months.'
  },
  {
    id: 'dx-generated',
    kind: 'condition',
    label: 'possible iron deficiency',
    date: '2026-11-10',
    status: 'suspected',
    origin: 'generated',
    confirmed: false,
    source: 'doc-lipid',
    summary: 'A low-ish MCV fits iron deficiency and thalassaemia; ferritin separates them.'
  },
  { id: 'dx-2024', kind: 'condition', label: 'hypertension', date: '2024-10-22', status: 'active', origin: 'doctor', confirmed: true, doctor: 'Dr Petro Melnyk', clinic: 'Family Practice' },
  { id: 'bp-2026', kind: 'observation', label: 'BP 150/110', when: '2026-10-15', value: 150, unit: 'mmHg' },
  { id: 'ob-2026', kind: 'observation', label: 'BP 160/100', when: '2026-11-21', value: 160, unit: 'mmHg' },
  { id: 'dec-stat', kind: 'decision', label: 'atorvastatin', date: '2026-11-19', decided_in: 'dx-doctor', assignment: 'drug', trust: 'low', no_alternative: true, confirmed: true },
  { id: 'dec-walk', kind: 'decision', label: 'walk daily', date: '2026-11-19', decided_in: 'dx-doctor', assignment: 'activity', trust: 'low', confirmed: false },
  { id: 'dec-yeast', kind: 'decision', label: 'red yeast rice', date: '2026-11-20', decided_in: 'dx-doctor', assignment: 'drug', trust: 'low', side_effect: true, confirmed: false },
  { id: 'dec-diet', kind: 'decision', label: 'less saturated fat', date: '2026-11-19', decided_in: 'dx-doctor', assignment: 'diet', confirmed: true },
  { id: 'dec-alcohol', kind: 'decision', label: 'two units a week', date: '2026-11-19', decided_in: 'dx-doctor', assignment: 'restriction', trust: 'unverified', confirmed: false },
  { id: 'dec-test', kind: 'decision', label: 'repeat panel', date: '2027-02-19', decided_in: 'dx-doctor', assignment: 'test', confirmed: true },
  { id: 'summ', kind: 'summary', label: '2025 in one page', date: '2026-01-01', confirmed: false, source: 'doc-lipid', period: '2025-01-01 – 2025-12-31', plan: ['a lipid panel'], fact: ['no panel'], held: ['the diary'], dropped: ['the annual panel'] }
]

const EDGES: Edge[] = [
  { from: 'lipid', to: 'doc-lipid', label: 'derived_from' },
  { from: 'lipid', to: 'dx-doctor', label: 'tracks' },
  { from: 'bp-2026', to: 'dx-2024', label: 'contradicts' }
]

const byId = (id: unknown) => NODES.find((n) => String(n.id) === String(id)) || null
const ctx = (over: Context = {}): Context => ({ nodes: NODES, edges: EDGES, byId, today: TODAY, ...over })
const row = (node: Node, over: Partial<Row> = {}): Row => ({
  id: String(node.id), kind: String(node.kind), date: String(node.date ?? node.when ?? ''),
  title: String(node.kind), note: String(node.label ?? node.id), stored: true, ...over
})

describe('the event picks the view, never the reader', () => {
  test('an analysis and an observation open the panel view', () => {
    expect(MV.viewOf(row(NODES[1]), byId('lipid'))).toBe('analysis')
    expect(MV.viewOf(row(NODES[2]), byId('single'))).toBe('analysis')
  })

  test('a condition opens the verdict view', () => {
    expect(MV.viewOf(row(NODES[3]), byId('dx-doctor'))).toBe('diagnosis')
  })

  test('a stored summary and both generated rows open the summary view', () => {
    expect(MV.viewOf(row(NODES[13]), byId('summ'))).toBe('summary')
    expect(MV.viewOf({ ...row(NODES[1]), id: 'today', kind: 'today', title: 'today summary', stored: false }, null)).toBe('summary')
    expect(MV.viewOf({ ...row(NODES[1]), id: 'annual:2025', stored: false }, null)).toBe('summary')
  })

  test('a decision or a visit is a record, not a state: no panel, no verdict, no period', () => {
    expect(MV.viewOf(row(NODES[8]), byId('dec-stat'))).toBe('record')
    expect(MV.viewOf({ id: 'e', kind: 'visit', date: '2024-01-01', title: 'visit', note: 'a visit', stored: true }, null)).toBe('record')
  })
})

describe('analysis: the whole panel as a table', () => {
  test('a lipid panel is four rows, and a value that is not a number is not one of them', () => {
    const rows = MV.markers(byId('lipid'))
    expect(rows.length).toBe(3)                       // the null value is dropped, not printed blank
    expect(rows.map((r) => r.name)).toEqual(['LDL', 'HDL', 'Triglycerides'])
  })

  test('a single test is a table of one row, read from the observation itself', () => {
    const rows = MV.markers(byId('single'))
    expect(rows.length).toBe(1)
    expect(rows[0].reference).toBe('4.11 – 5.89')
  })

  test("the lab's printed flag wins, and a range reading is not dressed up as the lab's", () => {
    const [ldl, hdl, tri] = MV.markers(byId('lipid'))
    expect(ldl.flag).toBe('high')
    expect(ldl.from).toBe('lab')
    expect(hdl.from).toBe('')                        // printed nothing, inside the range
    expect(tri.from).toBe('range')                   // printed nothing, above the range
    expect(tri.out).toBe(true)
    expect(hdl.out).toBe(false)
  })

  test('a marker with no reference range still shows, with an empty reference', () => {
    const [only] = MV.markers({ id: 'x', kind: 'observation', value: 7, unit: 'mg/l' })
    expect(only.reference).toBe('')
    expect(only.ref).toBeNull()
  })

  test('lab, address and the scan resolve through the document the records points at', () => {
    const source = MV.sourceOf(byId('lipid'), byId)
    expect(source.lab).toBe('City Lab')
    expect(source.address).toContain('Shevchenka')
    expect(source.link).toBe('sources/lipid.pdf')
    expect(source.document?.label).toBe('Lipid panel — City Lab')
    expect(source.gaps).toEqual([])
  })

  test('what is missing is said, not left blank', () => {
    const source = MV.sourceOf({ id: 'bare', kind: 'analysis', value: 1, unit: 'x' }, byId)
    expect(source.lab).toBe('')
    expect(source.gaps).toContain('no document behind it')
    expect(source.gaps).toContain('no scan to open')
  })

  test('the plain-language meaning is the record\'s own words', () => {
    expect(MV.meaning(byId('lipid'))).toContain('builds plaque')
    expect(MV.meaning({ id: 'x' })).toBe('')
  })

  test('linked items are the edges around the record, dated and named', () => {
    const links = MV.linked(byId('lipid'), ctx())
    expect(links.map((l) => l.id).sort()).toEqual(['doc-lipid', 'dx-doctor'])
    expect(links.every((l) => !!l.date)).toBe(true)
  })

  test('a decision links back to the note that decided it, without a second edge', () => {
    const links = MV.linked(byId('dec-stat'), ctx())
    expect(links.map((l) => l.rel)).toEqual(['decided_in'])
    expect(links.map((l) => l.id)).toEqual(['dx-doctor'])
  })

  test('a note does not list its own assignments twice — they are widget 15, not 13', () => {
    const links = MV.linked(byId('dx-doctor'), ctx()).map((l) => l.id)
    expect(links).not.toContain('dec-stat')
  })
})

describe('diagnosis: two kinds that never mix', () => {
  test('an official note carries full text, doctor, clinic and links', () => {
    const v = MV.verdict(byId('dx-doctor'), ctx())
    expect(v.official).toBe(true)
    expect(v.generated).toBe(false)
    expect(v.doctor).toContain('Anya Kovalenko')
    expect(v.clinic).toContain('City Clinic')
    expect(v.links.map((l) => l.href)).toContain('sources/note.pdf')
    expect(v.text).toContain('statin')
    expect(v.badge).toBe('')
  })

  test('a generated note carries the badge, no doctor link, and the yellow triangle', () => {
    const v = MV.verdict(byId('dx-generated'), ctx())
    expect(v.generated).toBe(true)
    expect(v.badge).toBe('not confirmed')
    expect(v.doctor).toBe('')
    expect(v.clinic).toBe('')
    expect(v.warning).toBe('check')
    expect(v.why.join(' ')).toContain('generated note')
  })

  test('an official note with nothing wrong carries no triangle at all', () => {
    expect(MV.verdict(byId('dx-doctor'), ctx()).warning).toBe('')
    expect(MV.verdict(byId('dx-doctor'), ctx()).why).toEqual([])
  })

  test('an unconfirmed note is never official just because it names a doctor', () => {
    expect(MV.isOfficial({ kind: 'condition', confirmed: false, origin: 'doctor', doctor: 'Dr X' })).toBe(false)
    expect(MV.isOfficial({ kind: 'condition', confirmed: true, origin: 'generated', doctor: 'Dr X' })).toBe(false)
    expect(MV.isOfficial({ kind: 'condition', confirmed: true, origin: 'doctor' })).toBe(true)
  })

  test('a note whose only link is its own scan still carries it, and never twice', () => {
    const note = { id: 'n', kind: 'condition', confirmed: true, origin: 'doctor', doctor: 'Dr X', scan: 'sources/scan.pdf' }
    expect(MV.verdict(note, ctx()).links.map((l) => l.href)).toEqual(['sources/scan.pdf'])
    expect(MV.verdict(note, ctx()).links[0].title).toBe('the original scan')
    expect(MV.verdict({ ...note, link: 'sources/scan.pdf' }, ctx()).links.length).toBe(1)
  })

  test("a doctor's note a later test contradicts gets the yellow triangle", () => {
    const v = MV.verdict(byId('dx-2024'), ctx())
    expect(v.warning).toBe('check')
    expect(v.why.join(' ')).toContain('later test contradicts')
    expect(v.contradicted.map((c) => c.id)).toContain('bp-2026')
  })

  test('a contradiction dated before the note does not fire', () => {
    const v = MV.verdict(byId('dx-doctor'), { ...ctx(), edges: [{ from: 'bp-2026', to: 'dx-doctor', label: 'contradicts' }] })
    expect(v.warning).toBe('')
    expect(v.contradicted).toEqual([])
  })

  test('danger is a skull, said in words', () => {
    const v = MV.verdict({ id: 'd', kind: 'condition', confirmed: true, origin: 'doctor', doctor: 'Dr X', warning: 'danger' }, ctx())
    expect(v.warning).toBe('danger')
    expect(v.why.join(' ')).toContain('do not act')
  })
})

describe('diagnosis: what was decided, in five groups', () => {
  test('assignments land in the group the note gives them', () => {
    const a = MV.assignments(byId('dx-doctor'), ctx())
    expect(MV.groups).toEqual(['tests', 'drugs', 'diet', 'activity', 'restrictions'])
    expect(a.drugs.map((i) => i.id).sort()).toEqual(['dec-stat', 'dec-yeast'])
    expect(a.activity.map((i) => i.id)).toEqual(['dec-walk'])
    expect(a.diet.map((i) => i.id)).toEqual(['dec-diet'])
    expect(a.restrictions.map((i) => i.id)).toEqual(['dec-alcohol'])
    expect(a.tests.map((i) => i.id)).toEqual(['dec-test'])
  })

  test('the decision\'s own name is the line, its prose only a second line', () => {
    const nodes = NODES.map((n) =>
      n.id === 'dec-stat'
        ? { ...n, label: 'atorvastatin 20 mg in the evening', text: 'Start it after the evening meal.' }
        : n)
    const a = MV.assignments(byId('dx-doctor'), ctx({ nodes }))
    const stat = a.drugs.find((i) => i.id === 'dec-stat')
    expect(stat?.label).toBe('atorvastatin 20 mg in the evening')
    expect(stat?.detail).toBe('Start it after the evening meal.')
    expect(MV.assignments(byId('dx-doctor'), ctx()).drugs.find((i) => i.id === 'dec-stat')?.detail).toBe('')
  })

  test('an assignment with no group is not guessed into one', () => {
    const nodes = NODES.concat([{ id: 'mystery', kind: 'decision', label: 'something', date: '2026-11-19', decided_in: 'dx-doctor' }])
    const a = MV.assignments(byId('dx-doctor'), ctx({ nodes }))
    expect(Object.values(a).flat().some((i) => i.id === 'mystery')).toBe(false)
  })

  test('model advice is red unless no alternative, a real diagnosis, or applied and it helped', () => {
    const real = MV.isRealDiagnosis(byId('dx-doctor'))
    expect(real).toBe(true)
    expect(MV.toneOf({ trust: 'low' }, true)).toEqual({ icon: 'amber', why: 'a real diagnosis stands behind it' })
    expect(MV.toneOf({ trust: 'low', no_alternative: true }, false).icon).toBe('amber')
    expect(MV.toneOf({ trust: 'low', applied: true, helped: true }, false).icon).toBe('amber')
    expect(MV.toneOf({ trust: 'low' }, false)).toEqual({ icon: 'red', why: 'low trust in the generator' })
    expect(MV.toneOf({ trust: 'unverified' }, false)).toEqual({ icon: 'amber', why: 'plausible, unverified' })
    expect(MV.toneOf({ trust: 'verified' }, false).icon).toBe('')
  })

  test('a known side effect is red and stays red — the escape rule is about model advice', () => {
    expect(MV.toneOf({ trust: 'low', side_effect: true, no_alternative: true }, true).icon).toBe('red')
    expect(MV.toneOf({ warning: 'danger' }, true).icon).toBe('skull')
  })

  test('a suspected generated diagnosis is not a real diagnosis', () => {
    expect(MV.isRealDiagnosis(byId('dx-generated'))).toBe(false)
    expect(MV.isRealDiagnosis({ kind: 'condition', status: 'suspected', origin: 'doctor', confirmed: true })).toBe(false)
  })

  test('the marks on the demo assignments: red for the supplement, yellow for the walk', () => {
    const a = MV.assignments(byId('dx-doctor'), ctx())
    const tone = (id: string) => Object.values(a).flat().find((i) => i.id === id)?.tone
    expect(tone('dec-yeast')).toBe('red')
    expect(tone('dec-walk')).toBe('amber')
    expect(tone('dec-alcohol')).toBe('amber')
    expect(tone('dec-stat')).toBe('amber')
    expect(tone('dec-test')).toBe('')
  })
})

describe('summary: a report, not a prescription', () => {
  test('a stored summary carries its own four lists', () => {
    const s = MV.summaryOf(row(NODES[13]), byId('summ'), ctx())
    expect(s.generated).toBe(false)
    expect(s.planned).toEqual(['a lipid panel'])
    expect(s.done).toEqual(['no panel'])
    expect(s.held).toEqual(['the diary'])
    expect(s.dropped).toEqual(['the annual panel'])
  })

  test('the today summary is computed from the document and says it makes no judgement', () => {
    const s = MV.summaryOf({ id: 'today', kind: 'today', date: TODAY, title: 'today summary', note: '', stored: false }, null, ctx())
    expect(s.generated).toBe(true)
    expect(s.done).toContain('Lipid panel · 2026-11-12')
    expect(s.planned.some((p) => p.includes('repeat panel'))).toBe(true)
    expect(s.held).toEqual([])
    expect(s.dropped).toEqual([])
    expect(s.note).toContain('nobody has said what held')
  })

  test('the annual marker counts its own year and nothing after it', () => {
    const s = MV.summaryOf({ id: 'annual:2024', kind: 'summary', date: '2025-01-01', title: 'annual summary', note: '', stored: false }, null, ctx())
    expect(s.period).toBe('2024-01-01 – 2024-12-31')
    expect(s.done.every((d) => d.endsWith('2024') || d.includes('2024-'))).toBe(true)
  })

  test('a summary hands out no links and no assignments — there is no such field', () => {
    const s = MV.summaryOf(row(NODES[13]), byId('summ'), ctx())
    expect(Object.keys(s).sort()).toEqual(['done', 'dropped', 'generated', 'held', 'note', 'period', 'planned'])
    expect(MV.summaryOf(row(NODES[13]), byId('summ'), ctx()).planned.every((l) => typeof l === 'string')).toBe(true)
  })
})

describe('the container the page draws (widget 9)', () => {
  test('there is one centre container, and the event fills it', () => {
    expect(page).toContain('id="main"')
    expect(page).toContain('id="mainBody"')
    expect(page).toContain('<script src="lib/main-view.js"></script>')
    expect(page).toContain('MainView.viewOf(row, node)')
    expect(page).toContain('box.dataset.view = view')
  })

  test('the four marks are one glyph each, with the meaning in the title', () => {
    expect(page).toContain('MARK_GLYPH')
    expect(page).toContain('yellow triangle: check before acting')
    expect(page).toContain('skull: dangerous, do not act')
    expect(page).toContain('red !: known side effect, or we do not trust the generator')
    expect(page).toContain('yellow !: plausible but unverified')
  })

  test('the table has the four columns the card names', () => {
    expect(page).toContain('["marker", "value", "reference", "flag"]')
  })

  test('a linked item opens in this view and highlights its row in the list', () => {
    expect(page).toContain('function openLinked(item)')
    expect(page).toContain('r.classList.add("hl")')
    expect(page).toContain('.srow.hl')
  })

  test('the summary view draws no linked list at all', () => {
    const start = page.indexOf('function renderSummary(')
    const end = page.indexOf('function renderRecord(')
    const body = page.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(body).not.toContain('linkedList(')
    expect(body).not.toContain('assignments(')
  })

  test('the page still writes nothing: a record is a view, never a saved fact', () => {
    expect(page).not.toContain('localStorage.setItem')
  })
})
