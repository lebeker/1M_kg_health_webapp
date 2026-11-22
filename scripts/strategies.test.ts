/**
 * The strategy gate through the door a reader uses — the CLI — and the demo document it writes.
 *
 * `src/strategies.test.ts` proves the arithmetic and the refusals. This proves three things a unit
 * test cannot:
 *
 *   1. the CLI and the module print the same nodes, so the JSON a reviewer pastes into a document
 *      is the JSON the module builds;
 *   2. `tests/fixtures/kg/valid/health-strategies.json` — "the demo must show the mechanics" — is
 *      exactly the five strategies' output placed on a record, so the fixture cannot drift from the
 *      code, and the contract gate (`bun run test:contract`) accepts it;
 *   3. a placement or a facts file that is wrong exits non-zero and says why, at the boundary where
 *      a person would meet it.
 *
 *   bun test scripts/strategies.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { STRATEGIES, materialise } from '../src/strategies'
import { type Issue, validateKg } from './lib/kg-contract'

const PLACEMENTS = 'tests/fixtures/strategies/placements-demo.json'
const ALL_MET = 'tests/fixtures/strategies/facts-all-met.json'
const NOTHING_KNOWN = 'tests/fixtures/strategies/facts-nothing-known.json'
const TYPE_MISMATCH = 'tests/fixtures/strategies/facts-type-mismatch.json'
const MISSING_STRATEGY = 'tests/fixtures/strategies/invalid-missing-strategy.json'
const HORIZON_BEFORE_PAPER = 'tests/fixtures/strategies/invalid-horizon-before-paper.json'
const DEMO = 'tests/fixtures/kg/valid/health-strategies.json'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const readJson = <T>(path: string): T => JSON.parse(read(path)) as T

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const done = Bun.spawnSync(['bun', 'scripts/strategies.ts', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: done.exitCode, stdout: done.stdout.toString(), stderr: done.stderr.toString() }
}

/** A fixture's notes are prose for a human; the module reads placements and facts only. */
const withoutNote = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'note'))

type PlanJson = { documents: unknown[]; predictions: unknown[]; edges: unknown[] }

describe('bun run strategies', () => {
  test('prints the five, each with a PMID and an interval, and what it does not know', () => {
    const done = run([])
    expect(done.exitCode).toBe(0)
    for (const strategy of STRATEGIES) {
      expect(done.stdout).toContain(strategy.id)
      expect(done.stdout).toContain(`PMID       ${strategy.source.pmid}`)
      expect(done.stdout).toContain(`RR ${strategy.effect.ratio.toFixed(2)} (95% CI`)
      expect(done.stdout).toContain(strategy.scale)
    }
    expect(done.stdout).toContain('what it does not know')
  })

  test('--plan --json is the module’s own plan: the papers, the forecasts, the projected edges', () => {
    const done = run([`--plan=${PLACEMENTS}`, '--json'])
    expect(done.exitCode).toBe(0)
    const printed = JSON.parse(done.stdout) as PlanJson

    const plan = materialise(withoutNote(readJson<Record<string, unknown>>(PLACEMENTS)))
    expect(printed).toEqual({ documents: plan.documents, predictions: plan.predictions, edges: plan.edges })

    const second = run([`--plan=${PLACEMENTS}`, '--json'])
    expect(second.stdout).toBe(done.stdout)
  })

  test('--plan and --facts gate the forecasts, one call per scale', () => {
    const done = run([`--plan=${PLACEMENTS}`, `--facts=${ALL_MET}`])
    expect(done.exitCode).toBe(0)
    expect(done.stdout).toContain('mve-log-rr/1  2 met, 0 withheld')
    expect(done.stdout).toContain('combined 0.6240')
    expect(done.stdout).toContain('crc-log-rr/1  1 met, 0 withheld')
    expect(done.stdout).toContain('cvd-log-rr/1  1 met, 0 withheld')
    expect(done.stdout).toContain('pred-statin-ldl')
    expect(done.stdout).toContain('source src-ctt-2010')
  })

  test('a withheld row prints its reason, and the scale it is on does not move', () => {
    const done = run([`--plan=${PLACEMENTS}`, `--facts=${NOTHING_KNOWN}`])
    expect(done.exitCode).toBe(0)
    expect(done.stdout).toContain('(missing-fact)')
    expect(done.stdout).toContain('mve-log-rr/1  1 met, 1 withheld')
    expect(done.stdout).toContain('cvd-log-rr/1  0 met, 1 withheld')
    expect(done.stdout).toContain('crc-log-rr/1  0 met, 1 withheld')
    expect(done.stdout).toContain('combined 1.0000')
    expect(done.stdout).toContain('a withheld row is not an error')
  })

  test('a fact of the wrong type withholds the forecast as a type mismatch', () => {
    const done = run([`--plan=${PLACEMENTS}`, `--facts=${TYPE_MISMATCH}`])
    expect(done.exitCode).toBe(0)
    expect(done.stdout).toContain('pred-statin-ldl')
    expect(done.stdout).toContain('(type-mismatch)')
  })

  test('a placement set of four is refused, and the missing strategy is named', () => {
    const done = run([`--plan=${MISSING_STRATEGY}`])
    expect(done.exitCode).toBe(1)
    expect(done.stdout).toBe('')
    expect(done.stderr).toContain(`refused: ${MISSING_STRATEGY}`)
    expect(done.stderr).toContain('placements.bp-lowering: missing')
  })

  test('a horizon before the paper was printed is refused', () => {
    const done = run([`--plan=${HORIZON_BEFORE_PAPER}`])
    expect(done.exitCode).toBe(1)
    expect(done.stderr).toContain('before 2010-11-13')
  })

  test('usage: a facts file without a placement is not enough, and a stray argument is an error', () => {
    const factsOnly = run([`--facts=${ALL_MET}`])
    expect(factsOnly.exitCode).toBe(2)
    expect(factsOnly.stderr).toContain('--plan=<placements.json>')

    const stray = run([PLACEMENTS])
    expect(stray.exitCode).toBe(2)
    expect(stray.stderr).toContain('unexpected argument(s)')
  })

  test('a placement file that is not JSON is a refusal, not a crash', () => {
    const done = run([`--plan=${DEMO.slice(0, -5)}.nope`])
    expect(done.exitCode).toBe(1)
    expect(done.stderr).toContain('refused:')
  })
})

describe('the demo document: the mechanics, on a record', () => {
  type Demo = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }
  const demo = readJson<Demo>(DEMO)
  const plan = materialise(withoutNote(readJson<Record<string, unknown>>(PLACEMENTS)))

  test('it is a document the contract accepts', () => {
    const issues: Issue[] = validateKg(demo)
    expect(issues).toEqual([])
  })

  test('its five forecasts are the module’s output, node for node', () => {
    const predictions = demo.nodes.filter((node) => node.kind === 'prediction')
    expect(predictions).toEqual(plan.predictions)
  })

  test('its five papers are the module’s documents, with the PMID and the interval on them', () => {
    const written = new Set(plan.documents.map((document) => String(document.id)))
    const documents = demo.nodes.filter((node) => written.has(String(node.id)))
    expect(documents).toEqual(plan.documents)
    for (const document of documents) {
      expect(String(document.pmid)).toMatch(/^\d{8}$/)
      expect(document.effect).toBeDefined()
    }
  })

  test('every forecast is drawn onto the node it is about, by a projected edge', () => {
    const projected = demo.edges.filter((edge) => edge.label === 'projected')
    expect(projected).toEqual(plan.edges)
    const targets = new Set(demo.nodes.map((node) => String(node.id)))
    for (const edge of projected) {
      expect(targets.has(String(edge.to))).toBe(true)
    }
  })

  test('the record it is placed on is a person, not a fixture: a lab document and its three markers', () => {
    const byId = new Map(demo.nodes.map((node) => [String(node.id), node]))
    for (const id of ['obs-ldl-2026-11', 'obs-hba1c-2026-11', 'obs-sbp-2026-11']) {
      const observation = byId.get(id)
      expect(observation?.kind).toBe('observation')
      expect(typeof observation?.value).toBe('number')
      expect(byId.get(String(observation?.source))?.kind).toBe('document')
    }
  })
})
