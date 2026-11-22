import { describe, expect, test } from 'bun:test'
import { inject } from './inject'

const BUILD = [
  '<!doctype html><html><head><title>knowledge graph</title></head>',
  '<body><div id="root"></div>',
  '<script id="kg-graph" type="application/json">{"meta":{"title":"old"},"nodes":[],"edges":[]}</script>',
  '</body></html>',
].join('')

describe('injecting a document into the built page', () => {
  test('replaces the payload and the title the app ships with', () => {
    const out = inject(BUILD, { meta: { title: 'SYNTHETIC — one check-up' }, nodes: [1], edges: [] })
    expect(out).toContain('<title>SYNTHETIC — one check-up</title>')
    expect(out).not.toContain('<title>knowledge graph</title>')
    expect(out).toContain('<script id="kg-graph" type="application/json">{"meta":{"title":"SYNTHETIC')
    expect(out).not.toContain('"title":"old"')
  })

  test('escapes a title that carries markup', () => {
    const out = inject(BUILD, { meta: { title: 'risk < 5% & falling' } })
    expect(out).toContain('<title>risk &lt; 5% &amp; falling</title>')
  })

  test('a payload with a closing script tag cannot end the script element early', () => {
    const out = inject(BUILD, { meta: { title: 'x' }, nodes: [{ description: '</script>' }], edges: [] })
    expect(out.match(/<\/script>/g)).toHaveLength(1)
    expect(out).toContain('<\\/script>')
  })

  test('a build without #kg-graph is an error, not a silently wrong replay', () => {
    expect(() => inject('<html><title>t</title></html>', { meta: { title: 'x' } })).toThrow(/kg-graph/)
  })

  test('no document title leaves the page title alone', () => {
    expect(inject(BUILD, { nodes: [] })).toContain('<title>knowledge graph</title>')
  })

  test('the case page keeps the product title, and still gets the document', () => {
    // `dist/demo.html` is built from a template whose title is the product's. Retitling it would
    // capture a page nobody ships, so the columns-page capture asks for the payload only.
    const out = inject(BUILD, { meta: { title: 'SYNTHETIC — one check-up' }, nodes: [1], edges: [] }, { title: false })
    expect(out).toContain('<title>knowledge graph</title>')
    expect(out).toContain('{"meta":{"title":"SYNTHETIC')
  })
})
