#!/usr/bin/env bun
/**
 * SCRUM-48 — the published copy of the case page, at both addresses that reach it.
 *
 * GitHub Pages serves this repository from `main` at its root, and that is the only case page a
 * reader can open without cloning anything. `dist/` is never published, so a reader who followed a
 * link into it got nothing. That was the first defect this build closes: `case.html` at the
 * repository root is the artifact, generated from the template and the case document.
 *
 * The second one is the address a reader reaches *without knowing a filename*. Pages answers `/`
 * with the repository's `index.html`, and that used to be the viewer's own entry document — a
 * script tag pointing at `/src/main.tsx`, which the published site does not serve at all. A visitor
 * who typed the site's address got a blank page. So `index.html` is written here too, from the same
 * `publishCase()` call and therefore with the same bytes as `case.html`: the root is the case, and
 * `case.html` stays as the alias the docs and the tests already name.
 *
 * Neither page can be the viewer's entry any more — one file cannot be both — so that document
 * lives at `graph.html` (see `vite.config.ts`).
 *
 * `case.html` and `index.html` are that artifact with one thing added: a `<base>` naming `body/`.
 * The page addresses its own assets relatively (`lib/…` and the model loader's `models/${file}.glb`)
 * and they live under `body/`, so one element makes every relative URL in the page resolve where it
 * does beside `dist/`. Nothing else differs apart from the build stamp (the clock the builder puts
 * in the page, which no comparison can hold): the markup, the styles and every byte of the payload
 * are the artifact's own, and `scripts/published-case.test.ts` holds both files to the output of
 * `buildDemo()` so they cannot drift from the template, the case document or each other.
 *
 * The template stays empty (`body/index.html` is what a reader's own document is rendered from) and
 * these pages are the case: opening one is a view and still writes nothing into storage.
 *
 *   bun scripts/build-case.ts           # write case.html and index.html
 *   bun scripts/build-case.ts --check   # fail if either copy on disk is stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SOURCE, TEMPLATE, buildDemo, unstamped } from './build-demo'
import { validateKg } from './lib/kg-contract'

/** The documented address: `<site>/case.html`. */
export const PUBLISHED = join(ROOT, 'case.html')
/** The bare address: GitHub Pages answers `/` with `index.html`, so this is what a visitor sees. */
export const ROOT_PAGE = join(ROOT, 'index.html')
/** Both files carry the same bytes; the pair exists so that neither address can 404 or go stale. */
export const PAGES: Array<{ path: string; name: string }> = [
  { path: ROOT_PAGE, name: 'index.html' },
  { path: PUBLISHED, name: 'case.html' },
]
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
    let stale = 0
    for (const page of PAGES) {
      let onDisk = ''
      try {
        onDisk = readFileSync(page.path, 'utf8')
      } catch {
        console.error(`${page.name} is missing — run \`bun run build:case\``)
        stale += 1
        continue
      }
      if (unstamped(onDisk) !== unstamped(published)) {
        console.error(`${page.name} is stale — run \`bun run build:case\``)
        stale += 1
      }
    }
    if (stale > 0) return 1
    console.log(`the published case page is current at both addresses (${byteSize(published)} bytes)`)
    return 0
  }

  for (const page of PAGES) writeFileSync(page.path, published)
  console.log(`index.html, case.html <- kg_demo.json + ${BASE} (${byteSize(published)} bytes)`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
