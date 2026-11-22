/**
 * SCRUM-47 evidence page: the real body/index.html with one fixture written into its `#kg-graph`
 * placeholder, so the right panel can be photographed on a past record that carries effects.
 *
 * `kg_demo.json` deliberately carries no `delta` or `evidence` (T21: certainty is not an
 * effect size), so its projection cannot move between two dates. The fixture in
 * `tests/fixtures/page/then-now.json` is the document that can, and the panel's model is the same
 * one the page runs. The output lands in `.cache/page-screenshot/` (gitignored) and is served by
 * any static server; nothing is written outside the repo.
 *
 *   node scripts/page-evidence.mjs
 *   (cd .cache/page-screenshot && python3 -m http.server 8766 --bind 127.0.0.1)
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(root, '.cache', 'page-screenshot')
mkdirSync(out, { recursive: true })
let html = readFileSync(join(root, 'body', 'index.html'), 'utf8')
const fixture = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'page', 'then-now.json'), 'utf8'))
const marker = '<script id="kg-graph" type="application/json">__KG_GRAPH__</script>'
if (!html.includes(marker)) throw new Error('body/index.html lost its #kg-graph placeholder (T01)')
const tag = '<script id="kg-graph" type="application/json">' + JSON.stringify(fixture) + '</script>'
html = html.replace(marker, tag)
writeFileSync(join(out, 'index.html'), html)
if (!existsSync(join(out, 'lib'))) cpSync(join(root, 'body', 'lib'), join(out, 'lib'), { recursive: true })
else cpSync(join(root, 'body', 'lib'), join(out, 'lib'), { recursive: true, force: true })
console.log(join(out, 'index.html'), html.length)
