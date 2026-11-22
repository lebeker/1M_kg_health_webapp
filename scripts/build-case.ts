#!/usr/bin/env bun
/**
 * SCRUM-48 — the published copy of the case page.
 *
 * GitHub Pages serves this repository from `main` at its root, and that is the only case page a
 * reader can open without cloning anything. The artifact is `dist/demo.html` and `dist/` is never
 * published, so a reader who followed the documented link got `body/index.html` — the template,
 * its placeholder still in it and no record to draw: an empty page. That is the defect this build
 * closes.
 *
 * `case.html` at the repository root is that same artifact with one thing added: a `<base>` naming
 * `body/`. The page addresses its own assets relatively (`lib/…` and the model loader's
 * `models/${file}.glb`) and they live under `body/`, so one element makes every relative URL in the
 * page resolve where it does beside `dist/`. Nothing else differs: the markup, the styles and every
 * byte of the payload are the artifact's own, and `scripts/published-case.test.ts` holds this file
 * to the output of `buildDemo()` so it cannot drift from the template or the case document.
 *
 * The template stays empty (`body/index.html` is what a reader's own document is rendered from) and
 * this page is the case: opening it is a view and still writes nothing into storage.
 *
 *   bun scripts/build-case.ts           # write case.html
 *   bun scripts/build-case.ts --check   # fail if the copy on disk is stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SOURCE, TEMPLATE, buildDemo } from './build-demo'
import { validateKg } from './lib/kg-contract'

export const PUBLISHED = join(ROOT, 'case.html')
/** Where the page's own assets live, seen from the root the published site is served at. */
export const ASSET_ROOT = 'body/'
/** One element, and no second way for a URL in the page to resolve. */
export const BASE = `<base href="${ASSET_ROOT}">`
/** A `<base>` has to precede every URL-bearing element, so it goes after the charset declaration. */
const HEAD_ANCHOR = '<meta charset="utf-8">'

const byteSize = (text: string): number => Buffer.byteLength(text, 'utf8')

/**
 * The published page: the artifact, with the one `<base>` its address needs.
 *
 * Throws on a template that carries the anchor twice or not at all — a `<base>` in the wrong place
 * is a page whose scripts all 404, and that should fail here rather than on a reader's screen.
 */
export function publishCase(template: string, doc: unknown): string {
  const built = buildDemo(template, doc)
  const found = built.split(HEAD_ANCHOR).length - 1
  if (found !== 1) throw new Error(`body/index.html must carry exactly one ${HEAD_ANCHOR}, found ${found}`)
  return built.replace(HEAD_ANCHOR, `${HEAD_ANCHOR}${BASE}`)
}

function main(argv: string[]): number {
  const template = readFileSync(TEMPLATE, 'utf8')
  const doc: unknown = JSON.parse(readFileSync(SOURCE, 'utf8'))

  const issues = validateKg(doc)
  if (issues.length > 0) {
    console.error(`kg_demo.json fails the kg/1-health contract (${issues.length} issue(s)):`)
    for (const issue of issues) console.error(`  ${issue.path}: ${issue.message}`)
    return 1
  }

  const published = publishCase(template, doc)

  if (argv.includes('--check')) {
    let onDisk = ''
    try {
      onDisk = readFileSync(PUBLISHED, 'utf8')
    } catch {
      console.error('case.html is missing — run `bun run build:case`')
      return 1
    }
    if (onDisk !== published) {
      console.error('case.html is stale — run `bun run build:case`')
      return 1
    }
    console.log(`case.html is current (${byteSize(published)} bytes)`)
    return 0
  }

  writeFileSync(PUBLISHED, published)
  console.log(`case.html <- kg_demo.json + ${BASE} (${byteSize(published)} bytes)`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
