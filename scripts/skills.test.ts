import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { SKILL_SCRIPTS, embeddedScript, scriptFile, skillFile } from './skills'

/**
 * T20 — two export skills for the parent `kg` skill.
 *
 * The card asks for two skills and nothing else: **markers → PDF** (every marker of the main
 * view — value, reference, flag, date, source — as one paginated card, no write to `kg.json`) and
 * **standard format** (survey the established record formats, then align with one and prove the
 * mapping). Both are handed to `kg` by `app.json`, never by a screen.
 *
 * A skill is prose an agent follows, so the only way to test one is to run what it says: the
 * blocks in `SKILL.md` are executed here exactly as an agent would run them, against the demo
 * document the app ships.
 *
 * What this file pins, and why each check exists:
 *   1. the frontmatter is a skill at all (`name`, `description` starting "Use when");
 *   2. the code block in each SKILL.md is byte-identical to the `.py` in the repo — the block is
 *      what travels, and a drifted block is a skill that runs different code than the tests;
 *   3. the exporter's marker rows equal `MainView.markers` and `MainView.sourceOf` run on the
 *      same demo — "every marker of the main view" is a claim about the app, and this is where
 *      it is checked rather than assumed;
 *   4. the PDF is a PDF: header, pages, every marker's name/value/reference/flag/date/source in
 *      the file, same bytes on a second run, and the graph untouched (hash before and after);
 *   5. the FHIR mapping survives its own round trip on the demo, and the comparison can fail —
 *      a tampered bundle must be reported as a mismatch, or the "pass" means nothing;
 *   6. app.json is how the webapp hands the skills to `kg`, so both are named there.
 */

const ROOT = join(import.meta.dirname, '..')
const DEMO = join(ROOT, 'body', 'demo', 'graph.json')
const CACHE = join(ROOT, '.cache', 'skills-test')

type MainViewMarker = {
  name: string; value: number; unit: string; ref: [number | null, number | null] | null
  reference: string; flag: string; from: string; out: boolean; code: string
}
type MainView = {
  markers: (node: Record<string, unknown> | null) => MainViewMarker[]
  sourceOf: (node: Record<string, unknown> | null, byId: (id: unknown) => Record<string, unknown> | null) => {
    lab: string; address: string; link: string; gaps: string[]
    document: { id: string; label: string; link: string; confirmed: boolean } | null
  }
}

const sandbox: { MainView?: MainView } = {}
vm.createContext(sandbox)
vm.runInContext(readFileSync(join(ROOT, 'body', 'lib', 'main-view.js'), 'utf8'), sandbox)
const MainView = sandbox.MainView as MainView

const graph = JSON.parse(readFileSync(DEMO, 'utf8')) as { nodes: Array<Record<string, unknown>> }
const byId = (id: unknown) =>
  graph.nodes.find((node) => node.id === id) ?? null

/** Run a skill's script the way the skill tells an agent to. */
function run(skill: string, script: string, args: string[]) {
  const done = Bun.spawnSync(['python3', scriptFile(skill, script), ...args], {
    cwd: ROOT, stdout: 'pipe', stderr: 'pipe',
  })
  return {
    code: done.exitCode,
    stdout: done.stdout.toString(),
    stderr: done.stderr.toString(),
  }
}

/** The bytes a WinAnsi-encoded PDF carries for a string, so a text check reads the file itself. */
function winansiBytes(string: string): Buffer {
  const mirror: Record<string, number> = {
    '–': 0x96, '—': 0x97, '·': 0xb7, 'µ': 0xb5, '…': 0x85, '×': 0x78, '→': 0x2d,
  }
  const bytes = [...string].flatMap((char) => {
    if (char in mirror) return [mirror[char]]
    const code = char.codePointAt(0) ?? 0x3f
    return code < 0x100 ? [code] : [0x3f]
  })
  return Buffer.from(bytes)
}

const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

beforeAll(() => {
  rmSync(CACHE, { recursive: true, force: true })
  mkdirSync(CACHE, { recursive: true })
})
afterAll(() => rmSync(CACHE, { recursive: true, force: true }))

describe('both skills are skills', () => {
  for (const { skill } of SKILL_SCRIPTS) {
    test(`${skill}: frontmatter names it and says when to use it`, () => {
      const markdown = readFileSync(skillFile(skill), 'utf8')
      expect(markdown.startsWith('---\n')).toBe(true)
      const front = markdown.slice(4, markdown.indexOf('\n---', 4))
      const name = /^name: (.+)$/m.exec(front)?.[1]
      const description = /^description: (.+)$/m.exec(front)?.[1]
      expect(name).toBe(skill)
      expect(description?.startsWith('Use when')).toBe(true)
      // One line: `kg` reads the description as a trigger, and a wrapped one breaks the parse.
      expect(description?.includes('\n')).toBe(false)
    })
  }
})

describe('the code a SKILL.md carries is the code the repo tests', () => {
  for (const { skill, script } of SKILL_SCRIPTS) {
    test(`${skill}: the block is a verbatim copy of ${script}`, () => {
      const markdown = readFileSync(skillFile(skill), 'utf8')
      const embedded = embeddedScript(markdown, script)
      expect(embedded).not.toBeNull()
      const source = readFileSync(scriptFile(skill, script), 'utf8').replace(/\n+$/, '')
      expect(embedded?.replace(/\n+$/, '')).toBe(source)
      // It reaches the agent without a build step, so it must not import anything but stdlib.
      for (const line of source.split('\n')) {
        if (!line.startsWith('import ') && !line.startsWith('from ')) continue
        const module = line.replace(/^import |^from /, '').split(/[ .]/)[0]
        expect(['argparse', 'json', 're', 'sys', '__future__', 'pathlib']).toContain(module)
      }
    })
  }
})

describe('markers-to-pdf: every marker of the main view, as one paginated card', () => {
  const pdf = join(CACHE, 'markers.pdf')
  let report: {
    pages: number
    markers: number
    flags_derived: number
    cards: Array<{
      node: string; label: string; date: string; panel: string
      source: string | null; source_label: string | null; lab: string; address: string
      link: string; gaps: string[]; meaning: string; markers: MainViewMarker[]
    }>
    skipped: Array<{ node: string }>
  }
  let bytes: Buffer
  let before: string

  beforeAll(() => {
    before = sha(readFileSync(DEMO))
    const runResult = run('markers-to-pdf', 'scripts/markers_to_pdf.py',
      ['--graph', DEMO, '--out', pdf, '--json'])
    expect(runResult.code).toBe(0)
    report = JSON.parse(runResult.stdout)
    bytes = readFileSync(pdf)
  })

  test('the export is read-only: the graph is byte-identical afterwards', () => {
    expect(sha(readFileSync(DEMO))).toBe(before)
    // …and it refuses to write over the graph even when asked.
    const refusal = run('markers-to-pdf', 'scripts/markers_to_pdf.py', ['--graph', DEMO, '--out', DEMO])
    expect(refusal.code).toBe(2)
    expect(refusal.stderr).toContain('never writes kg.json')
    expect(sha(readFileSync(DEMO))).toBe(before)
  })

  test('every row equals the main view\'s own marker', () => {
    const exported = report.cards.flatMap((card) =>
      card.markers.map((marker) => ({ ...marker, node: card.node, date: card.date })))
    const fromApp = graph.nodes
      .filter((node) => node.kind === 'analysis' || node.kind === 'observation')
      .flatMap((node) =>
        MainView.markers(node).map((marker) => ({
          ...marker,
          node: node.id,
          date: String(node.date ?? node.when ?? ''),
        })))
    expect(exported.length).toBe(fromApp.length)
    expect(exported.length).toBeGreaterThan(0)
    for (const want of fromApp) {
      const got = exported.find((row) => row.node === want.node && row.name === want.name)
      expect(got).toBeDefined()
      for (const field of ['value', 'unit', 'reference', 'flag', 'from', 'out', 'code', 'date'] as const) {
        expect({ field, got: got?.[field] }).toEqual({ field, got: want[field] })
      }
      expect(got?.ref).toEqual(want.ref)
    }
  })

  test('the source of every card equals what the app resolves, gaps included', () => {
    for (const card of report.cards) {
      const node = byId(card.node)
      const app = MainView.sourceOf(node, byId)
      expect(card.lab).toBe(app.lab)
      expect(card.address).toBe(app.address)
      expect(card.link).toBe(app.link)
      expect(card.gaps).toEqual(app.gaps)
      expect(card.source).toBe(app.document?.id ?? null)
      expect(card.source_label).toBe(app.document?.label ?? null)
    }
  })

  test('the file is a PDF, and it is paginated', () => {
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
    expect(bytes.subarray(-8).toString('latin1').trim().endsWith('%%EOF')).toBe(true)
    expect(report.pages).toBeGreaterThanOrEqual(2)
    const pageObjects = bytes.toString('latin1').match(/\/Type \/Page /g) ?? []
    expect(pageObjects.length).toBe(report.pages)
    // Page N of M on every page, so a separated page still says where it came from.
    for (let page = 1; page <= report.pages; page++) {
      expect(bytes.includes(winansiBytes(`page ${page} of ${report.pages}`))).toBe(true)
    }
  })

  test('all five fields the card names are in the file for every marker', () => {
    for (const card of report.cards) {
      for (const marker of card.markers) {
        const cells = [
          marker.name,
          String(marker.value),
          marker.reference || '—',
          marker.flag || 'above range',
          card.date || '—',
          card.source || 'no document behind it',
        ]
        for (const cell of cells) {
          expect({ cell, present: bytes.includes(winansiBytes(cell)) }).toEqual({ cell, present: true })
        }
      }
    }
    // A lab flag and the export's own reading are never the same word on the page.
    if (report.flags_derived > 0) {
      expect(bytes.includes(winansiBytes('printed no flag'))).toBe(true)
    }
  })

  test('the same graph produces the same bytes', () => {
    const again = join(CACHE, 'markers-again.pdf')
    expect(run('markers-to-pdf', 'scripts/markers_to_pdf.py', ['--graph', DEMO, '--out', again]).code).toBe(0)
    expect(sha(readFileSync(again))).toBe(sha(bytes))
  })

  test('a panel too long for one page repeats its heading, and every row survives', () => {
    const long = join(CACHE, 'long-graph.json')
    const markers = Array.from({ length: 60 }, (_, index) => ({
      name: `Marker ${String(index + 1).padStart(2, '0')}`,
      value: 10 + index,
      unit: 'mg/l',
      ref: [5, 20],
      flag: index % 3 === 0 ? 'high' : '',
      code: `1234-${index + 1}`,
    }))
    writeFileSync(long, JSON.stringify({
      schema: 'kg/1',
      meta: { title: 'a long panel' },
      nodes: [{
        id: 'obs-long', kind: 'analysis', label: 'Full panel', when: '2026-03-03',
        panel: 'comprehensive', values: markers,
      }],
      edges: [],
    }))
    const out = join(CACHE, 'long.pdf')
    const done = run('markers-to-pdf', 'scripts/markers_to_pdf.py', ['--graph', long, '--out', out, '--json'])
    expect(done.code).toBe(0)
    const longReport = JSON.parse(done.stdout)
    expect(longReport.markers).toBe(60)
    expect(longReport.pages).toBeGreaterThan(1)
    const longBytes = readFileSync(out)
    // The heading is repeated on the page a card continues onto, or the rows lose their panel.
    expect(longBytes.includes(Buffer.from('continued'))).toBe(true)
    for (const marker of markers) {
      expect(longBytes.includes(winansiBytes(marker.name))).toBe(true)
    }
  })

  test('a record with no number is counted and named, not printed as an empty row', () => {
    const empty = join(CACHE, 'no-markers.json')
    writeFileSync(empty, JSON.stringify({
      schema: 'kg/1',
      meta: { title: 'a document with no numbers' },
      nodes: [{ id: 'obs-empty', kind: 'observation', label: 'no result yet', when: '2026-01-01' }],
      edges: [],
    }))
    const out = join(CACHE, 'no-markers.pdf')
    const done = run('markers-to-pdf', 'scripts/markers_to_pdf.py', ['--graph', empty, '--out', out, '--json'])
    expect(done.code).toBe(0)
    const emptyReport = JSON.parse(done.stdout)
    expect(emptyReport.markers).toBe(0)
    expect(emptyReport.skipped.map((entry: { node: string }) => entry.node)).toEqual(['obs-empty'])
    expect(readFileSync(out).subarray(0, 4).toString('latin1')).toBe('%PDF')
  })
})

describe('markers-to-fhir: the mapping proves itself', () => {
  const bundlePath = join(CACHE, 'bundle.json')
  let before: string
  let roundtrip: {
    markers: number; observations: number; diagnostic_reports: number
    roundtrip: { compared: number; mismatches: unknown[]; structural_issues: unknown[]; passed: boolean }
    not_carried: { unmapped_units: string[]; no_loinc_code: unknown[] }
  }

  beforeAll(() => {
    before = sha(readFileSync(DEMO))
    const exported = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', DEMO, '--out', bundlePath])
    expect(exported.code).toBe(0)
    const checked = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', DEMO, '--bundle', bundlePath, '--roundtrip', '--json'])
    expect(checked.code).toBe(0)
    roundtrip = JSON.parse(checked.stdout)
  })

  test('the bundle is written beside the graph and the graph is byte-identical afterwards', () => {
    expect(sha(readFileSync(DEMO))).toBe(before)
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
    expect(bundle.resourceType).toBe('Bundle')
    expect(bundle.type).toBe('collection')
    const resources: Array<Record<string, unknown>> = bundle.entry.map(
      (entry: { resource: Record<string, unknown> }) => entry.resource)
    // One Observation per marker, one report per panel, and no report without a result.
    const observations = resources.filter((resource) => resource.resourceType === 'Observation')
    expect(observations.length).toBe(roundtrip.markers)
    const reports = resources.filter((resource) =>
      resource.resourceType === 'DiagnosticReport') as Array<{ result: Array<{ reference: string }> }>
    expect(reports.length).toBe(6)
    for (const report of reports) expect(report.result.length).toBeGreaterThan(0)
    // …and it refuses to write over the graph even when asked.
    const refusal = run('markers-to-fhir', 'scripts/markers_to_fhir.py', ['--graph', DEMO, '--out', DEMO])
    expect(refusal.code).toBe(2)
    expect(sha(readFileSync(DEMO))).toBe(before)
  })

  test('every marker came back: name, value, unit, flag, range, code, date, source', () => {
    expect(roundtrip.roundtrip.compared).toBe(roundtrip.markers)
    expect(roundtrip.roundtrip.mismatches).toEqual([])
    expect(roundtrip.roundtrip.structural_issues).toEqual([])
    expect(roundtrip.roundtrip.passed).toBe(true)
    expect(roundtrip.markers).toBe(13)
  })

  test('the comparison can fail: a tampered value is a mismatch', () => {
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
    const observation = bundle.entry
      .map((entry: { resource: { resourceType: string; valueQuantity?: { value: number } } }) => entry.resource)
      .find((resource: { resourceType: string; valueQuantity?: { value: number } }) =>
        resource.resourceType === 'Observation' && resource.valueQuantity)
    const original = observation.valueQuantity.value
    observation.valueQuantity.value = original + 1
    const tampered = join(CACHE, 'bundle-tampered.json')
    writeFileSync(tampered, JSON.stringify(bundle))
    const checked = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', DEMO, '--bundle', tampered, '--roundtrip', '--json'])
    expect(checked.code).toBe(1)
    const result = JSON.parse(checked.stdout)
    expect(result.roundtrip.passed).toBe(false)
    expect(result.roundtrip.mismatches.length).toBeGreaterThan(0)
    observation.valueQuantity.value = original
  })

  test('nothing is invented: no patient, no guessed code, the printed flag is the lab\'s', () => {
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
    const resources = bundle.entry.map((entry: { resource: Record<string, unknown> }) => entry.resource)
    expect(resources.some((resource) => resource.resourceType === 'Patient')).toBe(false)
    for (const observation of resources.filter((resource) => resource.resourceType === 'Observation')) {
      // No `subject`: a reference to a patient the document does not identify would be a lie.
      expect(observation.subject).toBeUndefined()
      expect(['final', 'preliminary']).toContain(observation.status)
      // A LOINC code is only ever the one the record carried.
      const coding = (observation.code as { coding?: Array<{ code: string; system: string }> }).coding
      if (coding) expect(coding[0].system).toBe('http://loinc.org')
      // An interpretation exists only when the lab printed a flag.
      const derived = (observation.note ?? []) as Array<{ text: string }>
      if (observation.interpretation) {
        expect(derived.some((note) => note.text.includes('printed no flag'))).toBe(false)
      }
      // The kg id travels, so the marker can be found again.
      expect((observation.identifier as Array<{ system: string }>)[0].system).toBe('urn:kg:node')
    }
    // The demo's lipid panel is the one with printed flags and LOINC codes.
    const lipid = resources.find((resource) => resource.id === 'lab-lipid-2026-11-1') as {
      interpretation: Array<{ coding: Array<{ code: string }> }>
      valueQuantity: { system: string; code: string }
    }
    expect(lipid.interpretation[0].coding[0].code).toBe('H')
    expect(lipid.valueQuantity.code).toBe('mmol/L')
  })

  test('the FHIR port reads the same markers as the app: every field, row by row', () => {
    // The doc and this script's header both say the port is pinned against `MainView`. This is
    // that pin: the module the SKILL.md block ships is imported and its own `cards_of` is run on
    // the demo, then compared with the app's `markers`/`sourceOf` — not with a third copy.
    const probe = [
      'import importlib.util, json, sys',
      "spec = importlib.util.spec_from_file_location('markers_to_fhir', sys.argv[1])",
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      "graph = json.load(open(sys.argv[2], encoding='utf-8'))",
      "print(json.dumps(module.cards_of(graph), ensure_ascii=False))",
    ].join('\n')
    const done = Bun.spawnSync(
      ['python3', '-c', probe, scriptFile('markers-to-fhir', 'scripts/markers_to_fhir.py'), DEMO],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    expect(done.stderr.toString()).toBe('')
    expect(done.exitCode).toBe(0)
    const cards = JSON.parse(done.stdout.toString()) as Array<{
      node: string; date: string; lab: string; address: string; link: string
      source: string | null; source_label: string | null; markers: MainViewMarker[]
    }>
    const exported = cards.flatMap((card) => card.markers.map((marker) => ({ ...marker, node: card.node })))
    const fromApp = graph.nodes
      .filter((node) => node.kind === 'analysis' || node.kind === 'observation')
      .flatMap((node) => MainView.markers(node).map((marker) => ({ ...marker, node: node.id })))
    expect(exported.length).toBe(fromApp.length)
    expect(exported.length).toBeGreaterThan(0)
    for (const want of fromApp) {
      const got = exported.find((row) => row.node === want.node && row.name === want.name)
      expect(got).toBeDefined()
      for (const field of ['value', 'unit', 'reference', 'flag', 'from', 'out', 'code'] as const) {
        expect({ field, got: got?.[field] }).toEqual({ field, got: want[field] })
      }
      expect(got?.ref).toEqual(want.ref)
    }
    for (const card of cards) {
      const app = MainView.sourceOf(byId(card.node), byId)
      expect({ node: card.node, lab: card.lab }).toEqual({ node: card.node, lab: app.lab })
      expect({ node: card.node, link: card.link }).toEqual({ node: card.node, link: app.link })
      expect(card.source).toBe(app.document?.id ?? null)
      expect(card.source_label).toBe(app.document?.label ?? null)
      // The date the card prints: `when`, else the demo-era `date`, cut to its day.
      const when = byId(card.node)?.when ?? byId(card.node)?.date
      if (typeof when === 'string') expect(card.date).toBe(/^\d{4}-\d{2}-\d{2}/.exec(when)?.[0] ?? '')
    }
  })

  test('a panel of ten or more rows round-trips clean — the rows are matched, not zipped', () => {
    // `…-10` sorts before `…-2`: a comparison that walks two lists in different orders reports
    // a correct bundle as broken from the tenth row on. Twelve rows is an ordinary CMP.
    const values = Array.from({ length: 12 }, (_, index) => ({
      name: `M${String(index).padStart(2, '0')}`, value: 10 + index, unit: 'mmol/l',
      ref: [5, 20], flag: index % 2 === 0 ? 'high' : '', code: `1234-${index}`,
    }))
    const panel = join(CACHE, 'twelve.json')
    writeFileSync(panel, JSON.stringify({
      schema: 'kg/1', meta: { title: 'a twelve row panel' },
      nodes: [{ id: 'obs-twelve', kind: 'analysis', label: 'CMP', when: '2026-04-04',
        panel: 'comprehensive', values }],
      edges: [],
    }))
    const out = join(CACHE, 'twelve-bundle.json')
    expect(run('markers-to-fhir', 'scripts/markers_to_fhir.py', ['--graph', panel, '--out', out]).code).toBe(0)
    const checked = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', panel, '--bundle', out, '--roundtrip', '--json'])
    expect(checked.code).toBe(0)
    const result = JSON.parse(checked.stdout)
    expect(result.roundtrip.compared).toBe(12)
    expect(result.roundtrip.mismatches).toEqual([])
    expect(result.roundtrip.structural_issues).toEqual([])
  })

  test('a kg id that is not a legal FHIR id still resolves: derivedFrom is the fullUrl', () => {
    // `doc_lipid_2026` is a legal kg id, so it must travel as `doc-lipid-2026` everywhere — and
    // the raw id must come back out of the DocumentReference's identifier.
    const graphPath = join(CACHE, 'underscore.json')
    writeFileSync(graphPath, JSON.stringify({
      schema: 'kg/1', meta: { title: 'underscore ids' },
      nodes: [
        { id: 'doc_lipid_2026', kind: 'document', label: 'Lipid printout', when: '2026-05-05',
          lab: 'Lab A', link: 'sources/lipid.pdf' },
        { id: 'obs_lipid_2026', kind: 'analysis', label: 'Lipids', when: '2026-05-05',
          source: 'doc_lipid_2026', panel: 'lipids', confirmed: true,
          values: [{ name: 'LDL', value: 3.9, unit: 'mmol/l', ref: [0, 3], flag: 'high',
            code: '13457-7' }] },
      ],
      edges: [],
    }))
    const out = join(CACHE, 'underscore-bundle.json')
    expect(run('markers-to-fhir', 'scripts/markers_to_fhir.py', ['--graph', graphPath, '--out', out]).code).toBe(0)
    const bundle = JSON.parse(readFileSync(out, 'utf8'))
    const urls: string[] = bundle.entry.map((entry: { fullUrl: string }) => entry.fullUrl)
    expect(urls).toContain('urn:kg:node:doc-lipid-2026')
    const observation = bundle.entry
      .map((entry: { resource: Record<string, unknown> }) => entry.resource)
      .find((resource: Record<string, unknown>) => resource.resourceType === 'Observation') as {
        derivedFrom: Array<{ reference: string }>
      }
    expect(observation.derivedFrom[0].reference).toBe('urn:kg:node:doc-lipid-2026')
    expect(urls).toContain(observation.derivedFrom[0].reference)
    const checked = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', graphPath, '--bundle', out, '--roundtrip', '--json'])
    expect(checked.code).toBe(0)
    const result = JSON.parse(checked.stdout)
    expect(result.roundtrip.mismatches).toEqual([])
    expect(result.roundtrip.structural_issues).toEqual([])

    // …and the new structural rule can fail: the raw id back in derivedFrom is a dangling reference.
    observation.derivedFrom[0].reference = 'urn:kg:node:doc_lipid_2026'
    const doctored = join(CACHE, 'underscore-doctored.json')
    writeFileSync(doctored, JSON.stringify(bundle))
    const control = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', graphPath, '--bundle', doctored, '--roundtrip', '--json'])
    expect(control.code).toBe(1)
    const controlResult = JSON.parse(control.stdout)
    expect(controlResult.roundtrip.structural_issues.length).toBeGreaterThan(0)
    expect(String(controlResult.roundtrip.structural_issues.join('\n'))).toContain('derives from')
  })

  test('an interval date exports its `from` day, which is what the mapping says', () => {
    // The mapping table claims this; the app's own `MainView` prints the start of the interval.
    const graphPath = join(CACHE, 'interval.json')
    writeFileSync(graphPath, JSON.stringify({
      schema: 'kg/1', meta: { title: 'an interval' },
      nodes: [{ id: 'obs-interval', kind: 'observation', label: 'HbA1c',
        when: { from: '2026-01-01', to: '2026-02-01' },
        value: 6.1, unit: '%', ref_low: 4, ref_high: 5.6 }],
      edges: [],
    }))
    const out = join(CACHE, 'interval-bundle.json')
    expect(run('markers-to-fhir', 'scripts/markers_to_fhir.py', ['--graph', graphPath, '--out', out]).code).toBe(0)
    const observation = JSON.parse(readFileSync(out, 'utf8')).entry
      .map((entry: { resource: Record<string, unknown> }) => entry.resource)
      .find((resource: Record<string, unknown>) => resource.resourceType === 'Observation')
    expect(observation.effectiveDateTime).toBe('2026-01-01')
    expect(observation.period).toBeUndefined()
    expect(run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', graphPath, '--bundle', out, '--roundtrip']).code).toBe(0)
  })

  test('a single-test record is an Observation with no report, and an unknown unit is reported', () => {
    const single = join(CACHE, 'single.json')
    writeFileSync(single, JSON.stringify({
      schema: 'kg/1',
      meta: { title: 'one test', app: 'health-viewer' },
      nodes: [
        { id: 'doc-1', kind: 'document', label: 'Printout', when: '2026-02-02', link: 'sources/p.pdf' },
        {
          id: 'obs-1', kind: 'observation', label: 'Ferritin', when: '2026-02-02', source: 'doc-1',
          value: 22, unit: 'ng/ml', ref_low: 30, ref_high: 400, flag: 'low', code: '2276-4',
        },
      ],
      edges: [],
    }))
    const out = join(CACHE, 'single-bundle.json')
    const report = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', single, '--out', out, '--json'])
    expect(report.code).toBe(0)
    const summary = JSON.parse(report.stdout)
    expect(summary.observations).toBe(1)
    expect(summary.diagnostic_reports).toBe(0)
    expect(summary.not_carried.unmapped_units).toEqual(['ng/ml'])
    const checked = run('markers-to-fhir', 'scripts/markers_to_fhir.py',
      ['--graph', single, '--bundle', out, '--roundtrip'])
    expect(checked.code).toBe(0)
    expect(checked.stdout).toContain('round trip: 1 observations read back, 0 field mismatches')
  })
})

describe('the webapp hands the skills to kg', () => {
  test('app.json requires both skills — the only channel the skill reads', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
      requires: { skills: string[] }
    }
    expect(manifest.requires.skills).toContain('kg')
    for (const { skill } of SKILL_SCRIPTS) expect(manifest.requires.skills).toContain(skill)
  })

  test('each declared skill has a SKILL.md at the path the installer fetches', () => {
    // `kg check --install` fetches `{skills_url}/{name}/SKILL.md`, with skills_url = main/skills.
    for (const { skill } of SKILL_SCRIPTS) {
      expect(readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8').length).toBeGreaterThan(2000)
    }
  })
})
