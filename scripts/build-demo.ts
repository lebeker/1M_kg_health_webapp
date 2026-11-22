#!/usr/bin/env bun
/**
 * T01 — build the demo page from the demo document.
 *
 * `body/index.html` is the template: it carries the `#kg-graph` placeholder and nothing else, and
 * it never fetches a sidecar. The demo is an artifact — the same page with the placeholder replaced
 * by `body/demo/kg_demo.json` — so the invented case lives in one document and one build output,
 * never in the template a reader's own page is rendered from.
 *
 *   bun scripts/build-demo.ts           # write body/demo.html
 *   bun scripts/build-demo.ts --check   # fail if the checked-in artifact is stale
 *
 * The contract gate runs first: an artifact built from a document the schema rejects is a demo
 * nobody can trust. The serialization is exported so the tests can prove the checked-in artifact is
 * exactly this function's output — a hand-edited demo page fails CI instead of drifting.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateKg } from './lib/kg-contract'

export const ROOT = resolve(import.meta.dirname, '..')
export const TEMPLATE = join(ROOT, 'body', 'index.html')
export const SOURCE = join(ROOT, 'body', 'demo', 'kg_demo.json')
export const ARTIFACT = join(ROOT, 'body', 'demo.html')
export const PLACEHOLDER = '__KG_GRAPH__'

const SCRIPT_OPEN = '<script id="kg-graph" type="application/json">'
const SCRIPT_CLOSE = '</script>'

/** The template's one payload slot, with the placeholder still in it. */
const marker = `${SCRIPT_OPEN}${PLACEHOLDER}${SCRIPT_CLOSE}`

/**
 * One JSON document, safe to inline in a `<script>` element. `<` is legal inside a JSON string, so
 * every one of them is written as the escape `\u003c`: the document survives the round trip and the
 * parser never sees a tag.
 */
export function serialize(doc: unknown): string {
  return JSON.stringify(doc).replace(/</g, '\\u003c')
}

/** The artifact: the template with the placeholder replaced by the document. Throws on a template
 *  that lost its slot — a page with two payloads would silently render the wrong one. */
export function buildDemo(template: string, doc: unknown): string {
  const count = template.split(marker).length - 1
  if (count !== 1) {
    throw new Error(`body/index.html must carry exactly one ${marker}, found ${count}`)
  }
  return template.replace(marker, `${SCRIPT_OPEN}${serialize(doc)}${SCRIPT_CLOSE}`)
}

function main(argv: string[]): number {
  const template = readFileSync(TEMPLATE, 'utf8')
  const doc: unknown = JSON.parse(readFileSync(SOURCE, 'utf8'))

  const issues = validateKg(doc)
  if (issues.length > 0) {
    console.error(`body/demo/kg_demo.json fails the kg/1-health contract (${issues.length} issue(s)):`)
    for (const issue of issues) console.error(`  ${issue.path}: ${issue.message}`)
    return 1
  }

  let built: string
  try {
    built = buildDemo(template, doc)
  } catch (error) {
    console.error((error as Error).message)
    return 1
  }

  if (argv.includes('--check')) {
    let onDisk = ''
    try {
      onDisk = readFileSync(ARTIFACT, 'utf8')
    } catch {
      console.error('body/demo.html is missing — run `bun scripts/build-demo.ts`')
      return 1
    }
    if (onDisk !== built) {
      console.error('body/demo.html is stale — run `bun scripts/build-demo.ts`')
      return 1
    }
    console.log(`body/demo.html is current (${built.length} bytes)`)
    return 0
  }

  writeFileSync(ARTIFACT, built)
  console.log(`body/demo.html <- body/demo/kg_demo.json (${built.length} bytes)`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
