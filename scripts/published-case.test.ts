import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ARTIFACT, ROOT, TEMPLATE, buildDemo, serialize } from './build-demo'
import { ASSET_ROOT, BASE, PUBLISHED, publishCase } from './build-case'

/**
 * SCRUM-48 — the page a reader opens from the published site.
 *
 * Pages serves this repository from `main` at its root, `dist/` is never published, and the
 * template was the only page there: the documented link opened a page with its placeholder still in
 * it, no record to draw and nothing to click but nothing. `case.html` is the case page for that
 * address — the artifact with one `<base>` naming where its assets live.
 *
 * These tests are why the shipped copy cannot drift into something else: it is compared to the
 * builder's output byte for byte, the one element that differs from `dist/demo.html` is named, and
 * every relative URL it publishes is resolved against the repository the site serves.
 */

const template = readFileSync(TEMPLATE, 'utf8')
const doc: unknown = JSON.parse(readFileSync(join(ROOT, 'kg_demo.json'), 'utf8'))
const published = readFileSync(PUBLISHED, 'utf8')

/**
 * Every `src`/`href` the page carries that a browser resolves relative to the document, minus the
 * `<base>` itself (which names a directory, not a file). A URL that is absolute, data or a fragment
 * resolves without the page's address and is none of this file's business.
 */
function references(html: string): string[] {
  return [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => !/^(?:https?:|data:|mailto:|#)/.test(url))
    .filter((url) => !url.endsWith('/'))
}

/** The `<script id="kg-graph">` payload, as the page's own reader would take it. */
function payload(html: string): string {
  const match = html.match(/<script id="kg-graph" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('no #kg-graph payload')
  return match[1]
}

describe('case.html is the case page, built from the template and the document', () => {
  test('the copy on disk is the builder output, byte for byte', () => {
    expect(published).toBe(publishCase(template, doc))
  })

  test('the only difference from dist/demo.html is the one <base> its address needs', () => {
    // a hand-edited page fails here instead of drifting from the template and the case document
    expect(published.replace(BASE, '')).toBe(buildDemo(template, doc))
    expect(published.split(BASE).length - 1).toBe(1)
  })

  test('the payload is the case document, and the artifact carries the same bytes', () => {
    expect(JSON.parse(payload(published))).toEqual(doc)
    expect(payload(published)).toBe(payload(readFileSync(ARTIFACT, 'utf8')))
    // the document itself is what makes a page: a placeholder is what the template starts with
    expect(payload(published)).not.toBe('__KG_GRAPH__')
    expect(serialize(doc).length).toBeGreaterThan(1000)
  })

  test('the <base> comes before every element whose URL it decides', () => {
    const base = published.indexOf(BASE)
    expect(base).toBeGreaterThan(published.indexOf('<head>'))
    expect(base).toBeLessThan(published.indexOf('<script src='))
    expect(base).toBeLessThan(published.indexOf('<script id="kg-graph"'))
    expect(base).toBeLessThan(published.indexOf('<body>'))
  })
})

describe('every relative URL the published page carries resolves from the repository root', () => {
  test('the base names a directory the site serves', () => {
    expect(existsSync(join(ROOT, ASSET_ROOT))).toBe(true)
  })

  test('the twelve scripts and the model path all exist where the site serves them', () => {
    const relative = references(published)
    expect(relative.length).toBe(12)
    for (const url of relative) expect(existsSync(join(ROOT, ASSET_ROOT, url))).toBe(true)
    // the models are loaded by the page's own loader from a path it builds, not from an attribute:
    // `models/${file}.glb`, which the <base> resolves exactly like the script tags
    const marker = 'models/${file}.glb'
    expect(published.includes(marker)).toBe(true)
    const model = marker.replace('${file}', 'cardio')
    expect(existsSync(join(ROOT, ASSET_ROOT, model))).toBe(true)
  })

  test('the assets it loads are the ones the template names, not a second copy', () => {
    // same strings as the template: nothing was rewritten, so nothing can drift
    expect(references(published)).toEqual(references(template))
  })
})

describe('the published page is a view and never a record', () => {
  test('it carries no storage API and no fetch of its own', () => {
    // the page has no write path at all, so "opening the case stores nothing" is structural
    expect(published).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.storage/)
    expect(published).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|new WebSocket/)
  })

  test('it carries no control that loads the case: the case is already in it', () => {
    expect(published).not.toMatch(/loadDemo|load-demo/i)
    expect(published).not.toMatch(/>\s*load the demo\s*</i)
    // the word is the template contract's: `grep -ri demo body/` is clean, and the published copy
    // is the same page, so it cannot be the one place the use case leaks in
    expect(published).not.toMatch(/\bdemo\b/i)
  })

  test('the document in it is the invented case, labelled in its own title', () => {
    const meta = (doc as { meta?: { title?: string } }).meta
    expect(String(meta?.title)).toContain('invented')
    expect(published).toContain(String(meta?.title))
  })
})
