#!/usr/bin/env bun
/**
 * The five built-in strategies on the command line: every number the demo would draw, and the gate
 * that decides which of them may move anything.
 *
 *   bun run strategies
 *   bun run strategies --plan=tests/fixtures/strategies/placements-demo.json
 *   bun run strategies --plan=<placements.json> --facts=<facts.json> [--json]
 *
 * Three runs, in the order the mechanics happen:
 *
 *   1. no flags        — the five as they are: the outcome, the published ratio with its interval,
 *                        what the ratio is per, the PMID and the citation, the log the delta is
 *                        taken to, and what the effect does not cover.
 *   2. --plan          — the nodes. One `document` node per paper (PMID, citation, effect) and one
 *                        `prediction` node per strategy, plus the `projected` edge to the node it is
 *                        about. `--json` prints exactly that, for pasting into a document; the demo
 *                        fixture `tests/fixtures/kg/valid/health-strategies.json` holds this output.
 *   3. --plan --facts  — the gate. The forecasts are grouped by scale (one outcome per scale), and
 *                        each group is gated once: a forecast whose condition is met moves the
 *                        number, one that is not stays where it was with the reason, and one whose
 *                        facts are unknown stays pending rather than firing on a guess.
 *
 * Exit 0 = printed, 1 = a strategy set, placement or facts file was refused (the refusal names
 * every problem), 2 = usage error.
 */
import { readFileSync } from 'node:fs'
import { STRATEGIES, StrategyError, gateStrategies, materialise } from '../src/strategies'

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/** Print a refusal as one header plus every problem, under the name of what was refused. */
function refuse(about: string, error: unknown): number {
  if (error instanceof StrategyError) {
    console.error(`refused: ${about} — ${error.problems.length} problem(s)`)
    for (const problem of error.problems) console.error(`  - ${problem}`)
    return 1
  }
  console.error(`refused: ${about} — ${error instanceof Error ? error.message : String(error)}`)
  return 1
}

/** A ratio and its interval, as a paper prints them — two decimals, the level named. */
function effectLine(ratio: number, low: number, high: number, level: number): string {
  return `RR ${ratio.toFixed(2)} (${Math.round(level * 100)}% CI ${low.toFixed(2)}–${high.toFixed(2)})`
}

/** Facts are a flat record; a `note` is fixture prose and never reaches the gate, as in lee.ts. */
function toFacts(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const facts: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'note') continue
    facts[key] = value
  }
  return facts
}

function printStrategies(): void {
  console.log('five built-in strategies — a published relative risk each, waiting on a condition\n')
  for (const strategy of STRATEGIES) {
    const { effect, source } = strategy
    console.log(`  ${strategy.id}  ·  ${strategy.scale}`)
    console.log(`    ${strategy.label}`)
    console.log(`    ${effectLine(effect.ratio, effect.interval.low, effect.interval.high, effect.interval.level)} ${effect.measure} of ${effect.outcome}`)
    console.log(`    per        ${effect.per}`)
    console.log(`    delta      ln ${effect.ratio} = ${Math.log(effect.ratio).toFixed(6)}   (a log, so two met strategies add the way their ratios multiply)`)
    console.log(`    PMID       ${source.pmid}  ${source.link}`)
    console.log(`    source     ${source.citation}`)
    console.log(`    when       ${JSON.stringify(strategy.when)}`)
    console.log(`    confidence ${strategy.confidence}`)
    console.log('    what it does not know:')
    for (const limit of strategy.limits) console.log(`      - ${limit}`)
    console.log('')
  }
  console.log('a strategy moves nothing until its condition is met: `--plan=<placements.json> --facts=<facts.json>`')
}

function printGate(planLabel: string, gates: ReturnType<typeof gateStrategies>): void {
  console.log(`gated on ${planLabel} — one call per scale, so two outcomes are never summed\n`)
  for (const { scale, gate, ratio } of gates) {
    const met = gate.applied.length
    const withheld = gate.withheld.length
    console.log(`  ${scale}  ${met} met, ${withheld} withheld  ·  combined ${ratio.toFixed(4)}`)
    for (const row of [...gate.applied, ...gate.withheld]) {
      const verdict = row.verdict === 'met' ? 'met     ' : `withheld`
      const reason = row.verdict === 'met' ? '' : `  (${row.reason})`
      console.log(
        `    ${row.id.padEnd(28)} ${verdict}  Δ ${row.delta_median.toFixed(4).padStart(8)}  RR ${Math.exp(row.delta_median).toFixed(4)}  source ${row.source}${reason}`,
      )
    }
    console.log('')
  }
  console.log('a withheld row is not an error: it is what the forecast would do, and why it has not yet')
}

function main(argv: string[]): number {
  const asJson = argv.includes('--json')
  const planFlag = argv.find((arg) => arg.startsWith('--plan='))
  const factsFlag = argv.find((arg) => arg.startsWith('--facts='))
  const stray = argv.filter((arg) => !arg.startsWith('-'))

  if (stray.length > 0) {
    console.error(`usage: bun scripts/strategies.ts [--plan=<placements.json>] [--facts=<facts.json>] [--json]`)
    console.error(`       unexpected argument(s): ${stray.join(', ')}`)
    return 2
  }
  if (factsFlag !== undefined && planFlag === undefined) {
    console.error('usage: bun scripts/strategies.ts --plan=<placements.json> --facts=<facts.json>')
    console.error('       a facts file gates the forecasts, and the forecasts need a placement (what they are about)')
    return 2
  }

  if (planFlag === undefined) {
    if (asJson) console.log(JSON.stringify(STRATEGIES, null, 2))
    else printStrategies()
    return 0
  }

  const planPath = planFlag.slice('--plan='.length)
  let plan: ReturnType<typeof materialise>
  try {
    plan = materialise(toFacts(readJson(planPath)))
  } catch (error) {
    return refuse(planPath, error)
  }

  if (factsFlag === undefined) {
    const nodes = { documents: plan.documents, predictions: plan.predictions, edges: plan.edges }
    if (asJson) console.log(JSON.stringify(nodes, null, 2))
    else {
      console.log(`${plan.documents.length} document node(s), ${plan.predictions.length} prediction node(s), ${plan.edges.length} projected edge(s)\n`)
      for (const node of plan.predictions) {
        console.log(`  ${String(node.id)}  → ${String(node.target)}  by ${String(node.horizon)}  Δ ${String(node.delta_median)}`)
      }
      console.log('\n`--json` prints the nodes for a document; the demo fixture holds the same output')
    }
    return 0
  }

  const factsPath = factsFlag.slice('--facts='.length)
  let gates: ReturnType<typeof gateStrategies>
  try {
    gates = gateStrategies(plan, toFacts(readJson(factsPath)) as Record<string, string | number | boolean>)
  } catch (error) {
    return refuse(factsPath, error)
  }

  if (asJson) {
    console.log(JSON.stringify(gates.map(({ scale, ratio, gate }) => ({ scale, ratio, gate })), null, 2))
    return 0
  }
  printGate(factsPath, gates)
  return 0
}

process.exit(main(process.argv.slice(2)))
