import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ARTIFACT, ROOT, TEMPLATE, buildDemo, serialize } from './build-demo'
import { ASSET_ROOT, BASE, PAGES, PUBLISHED, ROOT_PAGE, publishCase } from './build-case'

/**
 * SCRUM-48 — the page a reader opens from the published site, at both addresses that reach it.
 *
 * Pages serves this repository from `main` at its root, `dist/` is never published, and the
 * template was the only page there: the documented link opened a page with its placeholder still in
 * it, no record to draw and nothing to click but nothing. `case.html` was the first answer — the
 * artifact with one `<base>` naming where its assets live.
 *
 * It was half an answer. Pages answers the bare address `/` with `index.html`, and that file was
 * the viewer's own entry document: a script tag for `/src/main.tsx`, which the published site does
 * not serve, so a visitor who typed the site's address got a blank page. The root is now written by
 * the same builder, with the same bytes as `case.html`, and the viewer's document lives at
 * `graph.html`, where the build can emit it as `dist/graph.html`.
 *
 * These tests are why the shipped copies cannot drift into something else: each is compared to the
 * builder's output byte for byte, the one element that differs from `dist/demo.html` is named, every
 * relative URL they publish is resolved against the repository the site serves, and the root page is
 * held to being the case rather than the entry document it used to be.
 */

const template = readFileSync(TEMPLATE, 'utf8')
const doc: unknown = JSON.parse(readFileSync(join(ROOT, 'kg_demo.json'), 'utf8'))
const onDisk = PAGES.map((page) => [page.name, readFileSync(page.path, 'utf8')] as const)
const published = new Map(onDisk).get('case.html') as string
const root = new Map(onDisk).get('index.html') as string
const both = onDisk.map(([, html]) => html)

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

describe('the published case page is built from the template and the document', () => {
  test('both copies on disk are the builder output, byte for byte', () => {
    const built = publishCase(template, doc)
    for (const [name, html] of onDisk) expect(html, name).toBe(built)
  })

  test('the bare address and the documented one serve the same bytes', () => {
    // one artifact, two names: `case.html` is the alias the docs and the tests already use, and
    // `index.html` is what Pages answers `/` with. Neither can drift from the other.
    expect(root).toBe(published)
    expect(PAGES.map((page) => page.name).sort()).toEqual(['case.html', 'index.html'])
    expect(PUBLISHED).toBe(join(ROOT, 'case.html'))
    expect(ROOT_PAGE).toBe(join(ROOT, 'index.html'))
  })

  test('the only difference from dist/demo.html is the one <base> its address needs', () => {
    // a hand-edited page fails here instead of drifting from the template and the case document
    for (const html of both) {
      expect(html.replace(BASE, '')).toBe(buildDemo(template, doc))
      expect(html.split(BASE).length - 1).toBe(1)
    }
  })

  test('the payload is the case document, and the artifact carries the same bytes', () => {
    for (const html of both) {
      expect(JSON.parse(payload(html))).toEqual(doc)
      expect(payload(html)).toBe(payload(readFileSync(ARTIFACT, 'utf8')))
      // the document itself is what makes a page: a placeholder is what the template starts with
      expect(payload(html)).not.toBe('__KG_GRAPH__')
    }
    expect(serialize(doc).length).toBeGreaterThan(1000)
  })

  test('the <base> comes before every element whose URL it decides', () => {
    for (const html of both) {
      const base = html.indexOf(BASE)
      expect(base).toBeGreaterThan(html.indexOf('<head>'))
      expect(base).toBeLessThan(html.indexOf('<script src='))
      expect(base).toBeLessThan(html.indexOf('<script id="kg-graph"'))
      expect(base).toBeLessThan(html.indexOf('<body>'))
    }
  })
})

describe('the root page is the case, not the viewer entry document', () => {
  test('it carries no reference to the module the published site never builds', () => {
    // the shape of the old defect: `index.html` was the vite entry, and its only body content was
    // a script tag for `/src/main.tsx`. Pages has no `/src/`, so the bare address drew nothing.
    expect(root).not.toContain('/src/main.tsx')
    // and its one payload slot is the case document, not the template's placeholder — the page's
    // own reader carries the placeholder string as the thing it refuses to draw, so the element
    // is what gets compared, not the whole file
    expect(payload(root)).not.toBe('__KG_GRAPH__')
    expect(JSON.parse(payload(root))).toEqual(doc)
    expect(root).toContain('id="stage"')
  })

  test('the entry document lives at graph.html, where the build can emit it', () => {
    const entry = readFileSync(join(ROOT, 'graph.html'), 'utf8')
    expect(entry).toContain('src="/src/main.tsx"')
    // the graph page's own slots, still placeholders: the template contract is about body/
    expect(entry).toContain('__KG_GRAPH__')
    expect(entry).toContain('__KG_DOCS__')
    // and it is not a case page: the case never leaks into the viewer's source document
    expect(entry).not.toContain(BASE)
  })
})

describe('every relative URL the published page carries resolves from the repository root', () => {
  test('the base names a directory the site serves', () => {
    expect(existsSync(join(ROOT, ASSET_ROOT))).toBe(true)
  })

  test('the thirteen scripts and the model path all exist where the site serves them', () => {
    for (const html of both) {
      const relative = references(html)
      expect(relative.length).toBe(13)
      for (const url of relative) expect(existsSync(join(ROOT, ASSET_ROOT, url))).toBe(true)
      // the models are loaded by the page's own loader from a path it builds, not from an
      // attribute: `models/${file}.glb`, which the <base> resolves exactly like the script tags
      const loader = /\bmodels\/\$\{\w+\}\.glb/.exec(html)
      expect(loader).not.toBeNull()
      const model = (loader as RegExpExecArray)[0].replace(/\$\{\w+\}/, 'cardio')
      expect(existsSync(join(ROOT, ASSET_ROOT, model))).toBe(true)
    }
  })

  test('the assets it loads are the ones the template names, not a second copy', () => {
    // same strings as the template: nothing was rewritten, so nothing can drift
    for (const html of both) expect(references(html)).toEqual(references(template))
  })
})

describe('the published page is a view and never a record', () => {
  test('it carries no storage API and no fetch of its own', () => {
    // the page has no write path at all, so "opening the case stores nothing" is structural
    for (const html of both) {
      expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.storage/)
      expect(html).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|new WebSocket/)
    }
  })

  test('it carries no control that loads the case: the case is already in it', () => {
    for (const html of both) {
      expect(html).not.toMatch(/loadDemo|load-demo/i)
      expect(html).not.toMatch(/>\s*load the demo\s*</i)
      // the word is the template contract's: `grep -ri demo body/` is clean, and the published copy
      // is the same page, so it cannot be the one place the use case leaks in
      expect(html).not.toMatch(/\bdemo\b/i)
    }
  })

  test('the document in it is the invented case, labelled in its own title', () => {
    const meta = (doc as { meta?: { title?: string } }).meta
    expect(String(meta?.title)).toContain('invented')
    for (const html of both) expect(html).toContain(String(meta?.title))
  })
})
