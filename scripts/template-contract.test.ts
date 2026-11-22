import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ARTIFACT, PLACEHOLDER, ROOT, buildDemo, serialize } from './build-demo'

/**
 * SCRUM-51 — the template contract, as a check.
 *
 * The owner's acceptance is a `grep`: `grep -ri demo body/ dist/graph.html` returns nothing. A
 * promise about strings is worth exactly the check that runs it, so this file is that check plus
 * the two things a `grep` cannot hold:
 *
 *   - the case is one document (`kg_demo.json`), not a mode, a flag or a query parameter, and it
 *     lives outside `body/`, where the template and its assets live;
 *   - the artifact in `dist/` is the template with the document in its placeholder and nothing
 *     else — the same page, different data.
 *
 * The `demo` word is allowed in exactly two places, both named by the card: the file
 * `kg_demo.json` and the build target `build:demo` in `package.json`. Everywhere else it is a
 * template that has learned about one use case.
 *
 * `grep -ri` matches binary files too, and four tracked Blender sources under `body/models/repair/`
 * contain the byte sequence inside a Blender modifier name (`ExplodeModifierData`). Those are
 * binary content the page never reads and no text edit can change; this check reads text files, so
 * it tests the thing the acceptance is about.
 */

const BINARY_SNIFF = 8000

/** Every file under `dir`, recursively, as paths relative to the repository root. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(relative(ROOT, path))
  }
  return out
}

/** Text or not, by the only test that matters here: does it contain a NUL byte? */
function isText(path: string): boolean {
  return !readFileSync(path).subarray(0, BINARY_SNIFF).includes(0)
}

const bodyFiles = walk(join(ROOT, 'body'))
const bodyText = bodyFiles.filter((path) => isText(join(ROOT, path)))

describe('the template and its assets are free of one use case', () => {
  test('no text file under body/ says "demo", in any case', () => {
    const hits = bodyText.filter((path) => /demo/i.test(readFileSync(join(ROOT, path), 'utf8')))
    expect(hits).toEqual([])
  })

  test('the case document is not inside the template directory', () => {
    // the one allowed home is the repository root, beside the template, not within it
    expect(bodyFiles.some((path) => /^body\/.*kg_demo\.json$/.test(path))).toBe(false)
    expect(existsSync(join(ROOT, 'kg_demo.json'))).toBe(true)
  })

  test('the template reads the placeholder and has no second way in', () => {
    const page = readFileSync(join(ROOT, 'body', 'index.html'), 'utf8')
    expect(page.split(`<script id="kg-graph" type="application/json">${PLACEHOLDER}</script>`).length - 1).toBe(1)
    expect(page).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|new WebSocket/)
    expect(page).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.storage/)
  })
})

describe('the built graph page carries no use case either', () => {
  const built = join(ROOT, 'dist', 'graph.html')

  test('dist/graph.html carries no "demo" word, when it has been built', () => {
    // a clean checkout has no dist/; `bun run build` is what makes this meaningful, and the e2e
    // harness builds it before it captures anything.
    //
    // The word, not the substring: the bundled markdown highlighter carries a keyword table for
    // C++ and Rust that contains `demote`, so `grep -i demo` finds that one line in a 2 MB file
    // whatever this repository does. No string this app owns has the word in it.
    if (!existsSync(built)) return
    expect(readFileSync(built, 'utf8')).not.toMatch(/\bdemo\b/i)
  })
})

describe('the case page is a build target, built from the case document', () => {
  test('package.json names the target the card names', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.['build:demo']).toContain('build-demo')
    expect(relative(ROOT, ARTIFACT)).toBe(join('dist', 'demo.html'))
  })

  test('the build writes the template, with the document in the one placeholder', () => {
    const template = readFileSync(join(ROOT, 'body', 'index.html'), 'utf8')
    const doc = JSON.parse(readFileSync(join(ROOT, 'kg_demo.json'), 'utf8'))
    const built = buildDemo(template, doc)
    // the difference is the payload and nothing else: same head, same scripts, same styles
    expect(built.replace(serialize(doc), PLACEHOLDER)).toBe(template)
  })
})
