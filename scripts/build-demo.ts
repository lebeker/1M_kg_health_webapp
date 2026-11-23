#!/usr/bin/env bun
/**
 * SCRUM-51 — build the case page from the template and the case document.
 *
 * `body/index.html` is the template: it carries the `#kg-graph` placeholder and nothing else, and
 * it never fetches a sidecar. `kg_demo.json` is the case. This build puts the one into the other
 * and writes `dist/demo.html` — so the invented case lives in one document and one build output,
 * never in the template a reader's own page is rendered from.
 *
 * Nothing about the page changes with the data: the output is the template with the placeholder
 * replaced, byte for byte — plus the build stamp (`buildStamp()` stamps the page itself, so "is
 * this the new file?" is answerable from the page). The stamp is the one thing that changes between
 * two builds of the same inputs, so every comparison of a built page to its source goes through
 * `unstamped()`: the content is compared, the clock is not.
 *
 *   bun scripts/build-demo.ts           # write dist/demo.html
 *   bun scripts/build-demo.ts --check   # fail if the artifact on disk is stale
 *
 * The contract gate runs first: an artifact built from a document the schema rejects is a case
 * nobody can trust. The serialization is exported so the tests can prove the artifact is exactly
 * this function's output — a hand-edited page in `dist/` fails CI instead of drifting.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateKg } from './lib/kg-contract'

export const ROOT = resolve(import.meta.dirname, '..')
export const TEMPLATE = join(ROOT, 'body', 'index.html')
export const SOURCE = join(ROOT, 'kg_demo.json')
export const OUT = join(ROOT, 'dist')
export const ARTIFACT = join(OUT, 'demo.html')
/**
 * The page's siblings, under the relative names the page itself uses. `lib/` is 800 kB and copied;
 * `models/` is 95 MB of tracked content and linked, because a build must not duplicate it.
 */
export const ASSETS: Array<{ from: string; to: string; link?: string }> = [
  { from: join(ROOT, 'body', 'lib'), to: join(OUT, 'lib') },
  { from: join(ROOT, 'body', 'models'), to: join(OUT, 'models'), link: join('..', 'body', 'models') },
]
export const PLACEHOLDER = '__KG_GRAPH__'
/**
 * The page is UTF-8 and full of `·` and `—`: a string's `length` is not its size on disk, and the
 * number this build prints should be the one `ls -l` prints.
 */
const byteSize = (text: string): number => Buffer.byteLength(text, 'utf8')

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
  const stamp = buildStamp()
  return template
    .replace(marker, `${SCRIPT_OPEN}${serialize(doc)}${SCRIPT_CLOSE}`)
    .replace('<title>My health story</title>',
      `<title>My health story</title><meta name="kg-build" content="${stamp}">`)
    .replace('<b class="only-main">My health story</b>',
      `<b class="only-main" title="built ${stamp}">My health story</b>`)
}

/** The build's own clock, to the second: the one value in the output that two builds disagree on. */
export function buildStamp(): string {
  return new Date().toISOString().replace(/\..*$/, 'Z')
}

/**
 * The page with its build stamp taken out, so a built page can be compared to its source (and to
 * another build of the same source) on content alone. The stamp is deliberately not comparable: it
 * is a clock, so a `--check` that compared it could only pass in the second it was built, and the
 * tests that hold `dist/demo.html` and the two published copies to the builder's output would be
 * green or red depending on when they ran. Every such comparison goes through this.
 *
 * Narrow on purpose: a `<meta name="kg-build">` and the wordmark's `title="built …"`, never a
 * reader's own title attribute.
 */
export function unstamped(html: string): string {
  return html
    .replace(/<meta name="kg-build" content="[^"]*">/g, '')
    .replace(/ title="built [^"]*"/g, '')
}

/** Put the page's assets where the page looks for them, replacing whatever an earlier build left. */
export function installAssets(out = OUT): void {
  mkdirSync(out, { recursive: true })
  for (const asset of ASSETS) {
    if (!existsSync(asset.from)) continue
    rmSync(asset.to, { recursive: true, force: true })
    if (asset.link) symlinkSync(asset.link, asset.to, 'dir')
    else cpSync(asset.from, asset.to, { recursive: true })
  }
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
      console.error('dist/demo.html is missing — run `bun run build:demo`')
      return 1
    }
    if (unstamped(onDisk) !== unstamped(built)) {
      console.error('dist/demo.html is stale — run `bun run build:demo`')
      return 1
    }
    console.log(`dist/demo.html is current (${byteSize(built)} bytes)`)
    return 0
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(ARTIFACT, built)
  installAssets()
  console.log(`dist/demo.html <- kg_demo.json (${byteSize(built)} bytes)`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
