import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateKg } from './lib/kg-contract'
import { embeddedScript, scriptFile, skillFile } from './skills'

/**
 * T22 — the `add-prediction` skill.
 *
 * The card is one line: **PubMed → HR + CI → cohort check → node; refuses without a PMID; the
 * result stays `not confirmed` until reviewed.** A skill is prose an agent follows, so the only way
 * to test one is to run what it says: this file runs the block inside `SKILL.md` (the code the
 * agent receives) exactly as the skill tells it to run, against fixture documents.
 *
 * What is pinned here, and why each check exists:
 *
 *   1. the frontmatter is a skill at all, and `app.json` names it — the handover channel;
 *   2. the code in `SKILL.md` is byte-identical to the `.py` the tests run — `scripts/skills.test.ts`
 *      holds that for every skill, and this file would be testing a different program otherwise;
 *   3. the happy path writes the paper's document node, the forecast and the `projected` edge, and
 *      the app's own contract checker accepts the result — G1 and the skill cannot disagree about
 *      what a document is;
 *   4. the result stays `not confirmed`: both nodes, always, and a plan that says otherwise is
 *      refused;
 *   5. every refusal the card names is a real exit 1 with a sentence a person can act on — no PMID,
 *      a link that is not the PMID's, a ratio outside its own interval, an odds ratio, a horizon
 *      before the paper, a condition that cannot wait;
 *   6. the cohort check refuses on `fail` **and** on `unknown`, because "we do not know whether she
 *      is in the trial" is not "she is in the trial";
 *   7. the PubMed step is real: a stub record proves the title and year are compared, a wrong title
 *      and a wrong year are refused, a PMID with no record is refused, an unreachable PubMed is
 *      exit 2 and writes nothing, and `--offline` says the PMID was not checked;
 *   8. the write is a write: an existing id is never rewritten, the bytes are deterministic, and the
 *      committed valid fixture equals what the skill produces, node for node.
 */

const ROOT = join(import.meta.dirname, '..')
const SCRIPT = scriptFile('add-prediction', 'scripts/add_prediction.py')
const SKILL = skillFile('add-prediction')
const BASE_GRAPH = join(ROOT, 'tests', 'fixtures', 'add-prediction', 'graph-before.json')
const PLAN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'add-prediction', 'plan-nordicc.json'), 'utf8'))
const FACTS = join(ROOT, 'tests', 'fixtures', 'add-prediction', 'facts-screening.json')
const AFTER_FIXTURE = join(ROOT, 'tests', 'fixtures', 'kg', 'valid', 'health-add-prediction.json')
/** The same document after a person did the review the skill asks for: the paper and its forecast confirmed. */
const REVIEWED_FIXTURE = join(ROOT, 'tests', 'fixtures', 'add-prediction', 'graph-reviewed.json')
const SCRATCH = join(ROOT, '.cache', 'add-prediction-test')

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Obj = { [key: string]: Json }

const base = JSON.parse(readFileSync(BASE_GRAPH, 'utf8')) as Obj
const after = JSON.parse(readFileSync(AFTER_FIXTURE, 'utf8')) as Obj
/** The plan fixture on disk — the script takes a path, and an agent writing one takes the same. */
let PLAN_FILE = ''

/**
 * A stub PubMed, in its own process.
 *
 * It cannot live in this one: the script is run with `Bun.spawnSync`, which blocks the event loop, so
 * a server in the test process would never answer the request the test is waiting for. The stub
 * takes its mode from the URL path and answers with the real esummary shape — `<i>` markup and a
 * trailing period included — so the title comparison is tested against something that looks like the
 * record, not like the fixture.
 */
const PUBMED_STUB = `
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TITLE = 'Effect of <i>Colonoscopy</i> Screening on Risks of Colorectal Cancer and Related Death.'


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        mode = parsed.path.strip('/') or 'exact'
        pmid = (parse_qs(parsed.query).get('id') or [''])[0]
        if mode == 'error':
            self.send_response(500)
            self.send_header('Content-Length', '4')
            self.end_headers()
            self.wfile.write(b'boom')
            return
        if mode == 'absent':
            payload = {'header': {}, 'result': {'uids': []}}
        else:
            payload = {
                'header': {'type': 'esummary', 'version': '0.3'},
                'result': {
                    'uids': [pmid],
                    pmid: {
                        'uid': pmid,
                        'title': 'Some Other Paper About Cholesterol' if mode == 'wrong-title' else TITLE,
                        'pubdate': '2019 Aug 20' if mode == 'wrong-year' else '2022 Oct 27',
                        'fulljournalname': 'N Engl J Med',
                    },
                },
            }
        body = json.dumps(payload).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
with open(sys.argv[1], 'w', encoding='utf-8') as handle:
    handle.write(str(server.server_address[1]))
server.serve_forever()
`

let stubPort = 0
let stubProcess: ReturnType<typeof Bun.spawn> | undefined

/** Run the skill's script the way the skill tells an agent to. */
function run(args: (string | number)[]): { code: number; out: string; err: string } {
  const done = Bun.spawnSync(['python3', SCRIPT, ...args.map(String)], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { code: done.exitCode ?? -1, out: done.stdout.toString(), err: done.stderr.toString() }
}

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Obj

/**
 * A fresh copy of the before-document in the scratch space, so no test can spoil another. A test
 * that needs a state the skill did not write (a reviewed document, for instance) copies a fixture
 * through `copyFile` instead.
 */
function graphFile(name: string, change?: (graph: Obj) => void): string {
  const graph = structuredClone(base)
  change?.(graph)
  const path = join(SCRATCH, `graph-${name}.json`)
  writeFileSync(path, `${JSON.stringify(graph, undefined, 2)}\n`)
  return path
}

/** A committed fixture copied into the scratch space, byte for byte, so the write cannot edit it. */
function copyFile(name: string, source: string): string {
  const path = join(SCRATCH, `graph-${name}.json`)
  writeFileSync(path, readFileSync(source))
  return path
}

/** A plan fixture with one field changed — the shape an agent fills, one mistake at a time. */
function planFile(name: string, change?: (plan: Obj) => void): string {
  const plan = structuredClone(PLAN) as Obj
  change?.(plan)
  const path = join(SCRATCH, `plan-${name}.json`)
  writeFileSync(path, `${JSON.stringify(plan, undefined, 2)}\n`)
  return path
}

/** The report `--json` prints, parsed — the run's own account of what it checked. */
function report(out: string): Record<string, Json> {
  return JSON.parse(out) as Record<string, Json>
}

const obj = (value: Json): Obj => value as Obj
const str = (value: Json): string => value as string
const list = (value: Json): Json[] => value as Json[]

beforeAll(async () => {
  mkdirSync(SCRATCH, { recursive: true })
  PLAN_FILE = join(SCRATCH, 'plan.json')
  writeFileSync(PLAN_FILE, `${JSON.stringify(PLAN, undefined, 2)}\n`)

  const stubPath = join(SCRATCH, 'pubmed_stub.py')
  writeFileSync(stubPath, PUBMED_STUB.trimStart())
  const portFile = join(SCRATCH, 'pubmed-port')
  stubProcess = Bun.spawn(['python3', stubPath, portFile], { stdout: 'ignore', stderr: 'ignore' })
  for (let attempt = 0; attempt < 300 && stubPort === 0; attempt += 1) {
    const text = existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : ''
    if (text === '') await Bun.sleep(20)
    else stubPort = Number(text)
  }
  expect(stubPort).toBeGreaterThan(0)
})

afterAll(() => {
  stubProcess?.kill()
  rmSync(SCRATCH, { recursive: true, force: true })
})

describe('the skill is a skill, and the app hands it over', () => {
  test('frontmatter names it and says when to use it', () => {
    const markdown = readFileSync(SKILL, 'utf8')
    expect(markdown.startsWith('---\n')).toBe(true)
    expect(markdown).toContain('name: add-prediction')
    expect(markdown).toContain('description: Use when')
  })

  test('the block in SKILL.md is the .py this file runs', () => {
    const markdown = readFileSync(SKILL, 'utf8')
    const block = embeddedScript(markdown, 'scripts/add_prediction.py')
    expect(block).not.toBeNull()
    expect(block?.replace(/\n+$/, '')).toBe(readFileSync(SCRIPT, 'utf8').replace(/\n+$/, ''))
  })

  test('app.json requires it — the only channel kg reads', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { requires: { skills: string[] } }
    expect(manifest.requires.skills).toContain('add-prediction')
  })
})

describe('PubMed → HR + CI → cohort check → node', () => {
  test('the happy path, offline: every check passes and nothing is written yet', () => {
    const graph = graphFile('happy')
    const before = hash(graph)
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--json'])

    expect(done.err).toBe('')
    expect(done.code).toBe(0)
    const out = report(done.out)
    expect(out.wrote).toBe(false)
    expect(obj(out.pmid).verified).toBe(false)
    expect(obj(out.pmid).reason).toBe('offline')
    expect(list(out.cohort).length).toBe(2)
    for (const check of list(out.cohort)) expect(obj(check).verdict).toBe('pass')
    expect(hash(graph)).toBe(before)

    const prediction = obj(out.prediction)
    expect(prediction.id).toBe('pred-colonoscopy-36214590')
    expect(prediction.kind).toBe('prediction')
    expect(prediction.confirmed).toBe(false)
    expect(prediction.source).toBe('src-pmid-36214590')
    expect(prediction.horizon).toBe('2036-03-04')
    expect(prediction.when).toBeUndefined()
    expect(prediction.delta_median).toBe(Math.log(0.82))
  })

  test('--write appends the paper, the forecast and the projected edge', () => {
    const graph = graphFile('write')
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write', '--json'])
    expect(done.code).toBe(0)

    const written = read(graph)
    const nodes = list(written.nodes).map(obj)
    const edges = list(written.edges).map(obj)

    const paper = nodes.find((node) => node.id === 'src-pmid-36214590')
    expect(paper).toBeDefined()
    expect(paper?.kind).toBe('document')
    expect(paper?.pmid).toBe('36214590')
    expect(paper?.when).toBe('2022-10-27')
    expect(paper?.link).toBe('https://pubmed.ncbi.nlm.nih.gov/36214590/')
    expect(paper?.confirmed).toBe(false)
    expect(obj(paper?.effect as Json).ratio).toBe(0.82)
    expect(obj(obj(paper?.effect as Json).interval).high).toBe(0.93)

    const forecast = nodes.find((node) => node.id === 'pred-colonoscopy-36214590')
    expect(forecast?.confirmed).toBe(false)
    expect(forecast?.delta_median).toBe(Math.log(0.82))

    const edge = edges.find((item) => item.from === 'pred-colonoscopy-36214590')
    expect(edge?.to).toBe('cond-adenoma-2026-03')
    expect(edge?.label).toBe('projected')
    expect(edge?.source).toBe('src-pmid-36214590')
  })

  test('the document the skill writes passes the app’s own contract gate', () => {
    const graph = graphFile('contract')
    expect(run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write']).code).toBe(0)
    const issues = validateKg(read(graph))
    expect(issues).toEqual([])
  })

  test('the committed valid fixture is exactly what the skill writes, node for node', () => {
    const graph = graphFile('fixture')
    expect(run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write']).code).toBe(0)
    const written = read(graph)
    expect(written.nodes).toEqual(after.nodes)
    expect(written.edges).toEqual(after.edges)
    expect(written.meta).toEqual(after.meta)
  })

  test('the same input writes the same bytes', () => {
    const first = graphFile('deterministic-a')
    const second = graphFile('deterministic-b')
    expect(run(['--graph', first, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write']).code).toBe(0)
    expect(run(['--graph', second, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write']).code).toBe(0)
    expect(hash(first)).toBe(hash(second))
  })

  test('a second run refuses: the id is in the document, and a forecast is never rewritten', () => {
    const graph = graphFile('idempotence')
    expect(run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write']).code).toBe(0)
    const before = hash(graph)
    const again = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write'])
    expect(again.code).toBe(1)
    expect(again.err).toContain('is already in this document')
    expect(hash(graph)).toBe(before)
  })

  test('a second forecast on the same paper reuses its document node instead of duplicating it', () => {
    const graph = graphFile('reuse')
    expect(run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write']).code).toBe(0)
    const second = planFile('reuse-second', (plan) => {
      plan.id = 'pred-colonoscopy-again'
      plan.label = 'The same screening, written down twice'
    })
    const done = run(['--graph', graph, '--plan', second, '--facts', FACTS, '--offline', '--write', '--json'])
    expect(done.code).toBe(0)
    expect(report(done.out).document_reused).toBe(true)
    const documents = list(read(graph).nodes)
      .map(obj)
      .filter((node) => node.id === 'src-pmid-36214590')
    expect(documents.length).toBe(1)
  })

  test('the reviewed fixture is the after-fixture with the paper and its forecast confirmed', () => {
    const reviewed = read(REVIEWED_FIXTURE)
    const expected = list(after.nodes).map((node) => {
      const copy = obj(node)
      const confirmed = copy.id === 'src-pmid-36214590' || copy.id === 'pred-colonoscopy-36214590'
      return confirmed ? { ...copy, confirmed: true } : copy
    })
    expect(reviewed.nodes).toEqual(expected)
    expect(reviewed.edges).toEqual(after.edges)
  })

  test('a paper a human already confirmed still takes a second forecast, and its node is left alone', () => {
    // The state a document is in after the review step: the paper and the first forecast are
    // `confirmed: false` no longer. A second forecast has to arrive here, reuse the paper untouched,
    // and exit 0 — this is the case the read-back used to fail after writing.
    const graph = copyFile('reviewed', REVIEWED_FIXTURE)
    const paperBefore = list(read(graph).nodes)
      .map(obj)
      .find((node) => node.id === 'src-pmid-36214590')

    const second = planFile('reviewed-second', (plan) => {
      plan.id = 'pred-colonoscopy-second'
      plan.label = 'The same screening, written down after the review'
    })
    const done = run(['--graph', graph, '--plan', second, '--facts', FACTS, '--offline', '--write', '--json'])
    expect(done.err).toBe('')
    expect(done.code).toBe(0)
    expect(report(done.out).document_reused).toBe(true)
    // The report says what is true of this run: the forecast is what a person has to confirm, not a
    // paper node the script left exactly as it found it.
    const review = obj(report(done.out).review)
    expect(list(review.ids)).toEqual(['pred-colonoscopy-second'])
    expect(str(review.message)).toContain('left as it stands')

    const written = read(graph)
    const nodes = list(written.nodes).map(obj)
    expect(nodes.filter((node) => node.id === 'src-pmid-36214590')).toEqual([paperBefore])
    expect(nodes.find((node) => node.id === 'pred-colonoscopy-36214590')?.confirmed).toBe(true)
    expect(nodes.find((node) => node.id === 'pred-colonoscopy-second')?.confirmed).toBe(false)
    expect(nodes.find((node) => node.id === 'pred-colonoscopy-second')?.delta_median).toBe(Math.log(0.82))
    const edges = list(written.edges).map(obj).filter((edge) => edge.from === 'pred-colonoscopy-second')
    expect(edges.length).toBe(1)
    expect(edges[0]?.to).toBe('cond-adenoma-2026-03')
  })

  test('a second forecast from the same paper with different numbers is refused, and nothing is written', () => {
    const graph = graphFile('reuse-mismatch')
    expect(run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline', '--write']).code).toBe(0)
    const before = hash(graph)
    const second = planFile('reuse-mismatch', (plan) => {
      plan.id = 'pred-colonoscopy-mismatch'
      obj(plan.effect).ratio = 0.7
      obj(obj(plan.effect).interval).low = 0.6
    })
    const done = run(['--graph', graph, '--plan', second, '--facts', FACTS, '--offline', '--write'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('effect.ratio')
    expect(done.err).toContain('0.7')
    expect(done.err).toContain('0.82')
    expect(hash(graph)).toBe(before)
  })

  test('a paper the abstract prints no age range for is recorded as not checked, not as passed', () => {
    const plan = planFile('no-age', (item) => {
      obj(item.study).age = null
    })
    const done = run(['--graph', graphFile('no-age'), '--plan', plan, '--facts', FACTS, '--offline', '--json'])
    expect(done.code).toBe(0)
    const check = list(report(done.out).cohort).map(obj).find((item) => item.dimension === 'age')
    expect(check?.verdict).toBe('not-checked')
    expect(str(check?.detail)).toContain('prints no age range')
  })
})

describe('the PMID is an identifier, not a claim', () => {
  test('no PMID: refused, and the refusal says why', () => {
    const plan = planFile('no-pmid', (item) => {
      delete obj(item.paper).pmid
    })
    const done = run(['--graph', graphFile('no-pmid'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('this skill refuses a strategy without one')
  })

  test('a PMID that is not bare digits is refused', () => {
    const plan = planFile('bad-pmid', (item) => {
      obj(item.paper).pmid = 'PMID-36214590'
    })
    const done = run(['--graph', graphFile('bad-pmid'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('is not a PubMed id')
  })

  test('a DOI link and a PMID that are not the same paper are refused', () => {
    const plan = planFile('bad-link', (item) => {
      obj(item.paper).link = 'https://doi.org/10.1056/NEJMoa2208375'
    })
    const done = run(['--graph', graphFile('bad-link'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('the link and the PMID have to be the same paper')
  })

  test('a blank citation is refused: a link alone is not a citation', () => {
    const plan = planFile('blank-citation', (item) => {
      obj(item.paper).citation = '  '
    })
    const done = run(['--graph', graphFile('blank-citation'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('a link alone is not a citation')
  })

  test('--offline never claims the PMID was verified', () => {
    const done = run(['--graph', graphFile('offline'), '--plan', PLAN_FILE, '--facts', FACTS, '--offline'])
    expect(done.code).toBe(0)
    expect(done.out).toContain('NOT checked against PubMed')
    expect(done.out).not.toContain('verified:')
  })
})

describe('HR + CI: the numbers have to be the paper’s', () => {
  test('an odds ratio is refused — it is not a relative risk', () => {
    const plan = planFile('odds-ratio', (item) => {
      obj(item.effect).measure = 'odds ratio'
    })
    const done = run(['--graph', graphFile('odds-ratio'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('an odds ratio is not a relative risk')
  })

  test('a measure that is not a ratio at all is refused', () => {
    const plan = planFile('mean-difference', (item) => {
      obj(item.effect).measure = 'mean difference'
    })
    expect(run(['--graph', graphFile('mean-difference'), '--plan', plan, '--offline']).code).toBe(1)
  })

  test('a point estimate outside its own interval is refused', () => {
    const plan = planFile('outside-interval', (item) => {
      obj(item.effect).ratio = 1.2
    })
    const done = run(['--graph', graphFile('outside-interval'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('outside its own interval')
  })

  test('a ratio of zero, a 95% level and a blank `per` are refused', () => {
    const cases: Array<[string, (effect: Obj) => void, string]> = [
      ['zero', (effect) => (effect.ratio = 0), 'the published point estimate'],
      ['level', (effect) => (obj(effect.interval).level = 95), 'a level between 0 and 1'],
      ['per', (effect) => (effect.per = ''), 'a relative risk is per a change'],
      ['quote', (effect) => (effect.quote = ''), 'the sentence of the abstract'],
    ]
    for (const [name, change, phrase] of cases) {
      const plan = planFile(`effect-${name}`, (item) => change(obj(item.effect)))
      const done = run(['--graph', graphFile(`effect-${name}`), '--plan', plan, '--offline'])
      expect(done.code).toBe(1)
      expect(done.err).toContain(phrase)
    }
  })
})

describe('a prediction is a simulation, not an event', () => {
  test('a `when` on the plan is refused', () => {
    const plan = planFile('with-when', (item) => {
      item.when = '2030-01-01'
    })
    const done = run(['--graph', graphFile('with-when'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('a prediction has no `when`')
  })

  test('a confirmation that arrives with the plan is refused', () => {
    const plan = planFile('with-confirmed', (item) => {
      item.confirmed = true
    })
    const done = run(['--graph', graphFile('with-confirmed'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('the plan does not take a confirmation')
  })

  test('a missing condition, prose condition, and an empty `all` are refused', () => {
    const cases: Array<[string, (plan: Obj) => void, string]> = [
      ['missing', (plan) => delete plan.condition, 'a forecast with nothing to wait for'],
      ['prose', (plan) => (plan.condition = 'on a statin'), 'a condition is an object'],
      ['empty-all', (plan) => (plan.condition = { all: [] }), 'can never fire'],
    ]
    for (const [name, change, phrase] of cases) {
      const plan = planFile(`condition-${name}`, change)
      const done = run(['--graph', graphFile(`condition-${name}`), '--plan', plan, '--offline'])
      expect(done.code).toBe(1)
      expect(done.err).toContain(phrase)
    }
  })

  test('confidence outside 0..1, no limits, and a blank limit are refused', () => {
    const cases: Array<[string, (plan: Obj) => void, string]> = [
      ['confidence', (plan) => (plan.confidence = 1.5), 'a number from 0 to 1'],
      ['no-limits', (plan) => (plan.limits = []), 'at least one'],
      ['blank-limit', (plan) => (plan.limits = ['ok', '']), 'every entry must say something'],
    ]
    for (const [name, change, phrase] of cases) {
      const plan = planFile(`plan-${name}`, change)
      const done = run(['--graph', graphFile(`plan-${name}`), '--plan', plan, '--offline'])
      expect(done.code).toBe(1)
      expect(done.err).toContain(phrase)
    }
  })

  test('a horizon that is not a date, or is before the paper, is refused', () => {
    const notDate = planFile('horizon-date', (item) => {
      item.horizon = '2036'
    })
    expect(run(['--graph', graphFile('horizon-date'), '--plan', notDate, '--offline']).err).toContain('must be a date')
    const before = planFile('horizon-before', (item) => {
      item.horizon = '2021-01-01'
    })
    const done = run(['--graph', graphFile('horizon-before'), '--plan', before, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('is before 2022-10-27')
  })

  test('a target that is not in the document, or is not an outcome, is refused', () => {
    const absent = planFile('target-absent', (item) => {
      item.target = 'cond-nope'
    })
    const missing = run(['--graph', graphFile('target-absent'), '--plan', absent, '--offline'])
    expect(missing.code).toBe(1)
    expect(missing.err).toContain('is not a node in this document')

    const document = planFile('target-document', (item) => {
      item.target = 'src-gastro-2026-03'
    })
    const wrong = run(['--graph', graphFile('target-document'), '--plan', document, '--offline'])
    expect(wrong.code).toBe(1)
    expect(wrong.err).toContain('expected condition or observation')
  })

  test('the study has to say who was studied', () => {
    const cases: Array<[string, (study: Obj) => void, string]> = [
      ['design', (study) => (study.design = ''), 'study.design: missing'],
      ['population', (study) => (study.population = ''), 'who was studied'],
      ['age', (study) => (study.age = { min: 64, max: 55 }), '0 <= min < max <= 130'],
      ['sex', (study) => (study.sex = 'both'), 'one of any, female, male'],
    ]
    for (const [name, change, phrase] of cases) {
      const plan = planFile(`study-${name}`, (item) => change(obj(item.study)))
      const done = run(['--graph', graphFile(`study-${name}`), '--plan', plan, '--offline'])
      expect(done.code).toBe(1)
      expect(done.err).toContain(phrase)
    }
  })
})

describe('the cohort check refuses `fail` and `unknown` alike', () => {
  test('an age outside the paper’s range is refused, with the range and the age', () => {
    const graph = graphFile('age-outside', (item) => {
      obj(obj(item.meta).profile).year_of_birth = 1950
    })
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('outside the paper')
    expect(done.err).toContain('55–64')
  })

  test('the wrong sex is refused', () => {
    const graph = graphFile('sex-wrong', (item) => {
      obj(obj(item.meta).profile).sex = 'male'
    })
    const plan = planFile('sex-wrong', (item) => {
      obj(item.study).sex = 'female'
    })
    const done = run(['--graph', graph, '--plan', plan, '--facts', FACTS, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('the paper studied female')
  })

  test('an enrolment fact that is false is refused, and one that is missing is too', () => {
    const plan = planFile('requires', (item) => {
      obj(item.study).requires = [{ fact: 'screening_colonoscopy', op: 'eq', value: true }]
    })
    const falseFact = run(['--graph', graphFile('requires-false'), '--plan', plan, '--facts', FACTS, '--offline'])
    expect(falseFact.code).toBe(1)
    expect(falseFact.err).toContain('outside the population studied')

    const unknownFact = run(['--graph', graphFile('requires-unknown'), '--plan', plan, '--offline'])
    expect(unknownFact.code).toBe(1)
    expect(unknownFact.err).toContain('is not recorded')
    expect(unknownFact.err).toContain('unknown is not a yes')
  })

  test('a document without a year of birth cannot pass the age check', () => {
    const graph = graphFile('no-birth', (item) => {
      delete obj(obj(item.meta).profile).year_of_birth
    })
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('year_of_birth is not in the document')
  })
})

describe('the document has to be a health map, and the ids have to be free', () => {
  test('a document that is not health-viewer is refused', () => {
    const graph = graphFile('wrong-app', (item) => {
      obj(item.meta).app = 'viewer'
    })
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('is not health-viewer')
  })

  test('a document without a profile is refused: the cohort check has nobody to check', () => {
    const graph = graphFile('no-profile', (item) => {
      delete obj(item.meta).profile
    })
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('graph.meta.profile: missing')
  })

  test('a prediction id that already exists is refused', () => {
    const plan = planFile('duplicate-id', (item) => {
      item.id = 'obs-ldl-2026-03'
    })
    const done = run(['--graph', graphFile('duplicate-id'), '--plan', plan, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('is already in this document')
  })

  test('one document id cannot stand for two papers', () => {
    const graph = graphFile('document-collision', (item) => {
      list(item.nodes).push({
        id: 'src-pmid-36214590',
        kind: 'document',
        label: 'A different paper under the same id',
        when: '2010-11-13',
        confirmed: true,
        pmid: '21067804',
      })
    })
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--offline'])
    expect(done.code).toBe(1)
    expect(done.err).toContain('two papers cannot share one document id')
  })

  test('a plan or facts file that is not JSON is a usage error, not a refusal', () => {
    const broken = join(SCRATCH, 'broken.json')
    writeFileSync(broken, '{ not json')
    const done = run(['--graph', graphFile('broken'), '--plan', broken, '--offline'])
    expect(done.code).toBe(2)
    expect(done.err).toContain('not JSON')
  })
})

describe('PubMed: the record is what the PMID means', () => {
  const stub = (mode: string) => `http://127.0.0.1:${stubPort}/${mode}`

  test('a matching record verifies: the title and the year are the record’s, and the report says so', () => {
    // The stub returns the title with PubMed's `<i>` markup and a trailing period, which is what the
    // real record does; the comparison has to be about the words, not the markup.
    const done = run([
      '--graph',
      graphFile('pubmed-ok'),
      '--plan',
      PLAN_FILE,
      '--facts',
      FACTS,
      '--pubmed-url',
      stub('exact'),
      '--json',
    ])
    expect(done.code).toBe(0)
    const pmid = obj(report(done.out).pmid)
    expect(pmid.verified).toBe(true)
    expect(str(pmid.year)).toBe('2022')
    expect(str(pmid.title)).toContain('Colorectal Cancer')
  })

  test('a title that is not the PMID’s title is refused', () => {
    const done = run([
      '--graph',
      graphFile('pubmed-title'),
      '--plan',
      PLAN_FILE,
      '--facts',
      FACTS,
      '--pubmed-url',
      stub('wrong-title'),
    ])
    expect(done.code).toBe(1)
    expect(done.err).toContain('one of the two is the wrong paper')
  })

  test('a year that is not the paper’s is refused', () => {
    const done = run([
      '--graph',
      graphFile('pubmed-year'),
      '--plan',
      PLAN_FILE,
      '--facts',
      FACTS,
      '--pubmed-url',
      stub('wrong-year'),
    ])
    expect(done.code).toBe(1)
    expect(done.err).toContain('the date printed on the paper is the date the forecast is made on')
  })

  test('a PMID with no record is refused, not written around', () => {
    const done = run([
      '--graph',
      graphFile('pubmed-absent'),
      '--plan',
      PLAN_FILE,
      '--facts',
      FACTS,
      '--pubmed-url',
      stub('absent'),
    ])
    expect(done.code).toBe(1)
    expect(done.err).toContain('does not resolve to a PubMed record')
  })

  test('an unreachable PubMed is exit 2, and nothing is written', () => {
    const graph = graphFile('pubmed-unreachable')
    const before = hash(graph)
    const done = run(['--graph', graph, '--plan', PLAN_FILE, '--facts', FACTS, '--pubmed-url', 'http://127.0.0.1:1/', '--timeout', '2'])
    expect(done.code).toBe(2)
    expect(done.err).toContain('PubMed is unreachable')
    expect(hash(graph)).toBe(before)
  })

  test('a record that is not PubMed’s (HTTP 500) is unreachable, not a verdict', () => {
    const done = run([
      '--graph',
      graphFile('pubmed-500'),
      '--plan',
      PLAN_FILE,
      '--facts',
      FACTS,
      '--pubmed-url',
      stub('error'),
      '--timeout',
      '2',
    ])
    expect(done.code).toBe(2)
    expect(done.err).toContain('HTTP 500')
  })
})
