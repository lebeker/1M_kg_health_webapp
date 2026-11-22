import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * T26 — release: skill and templates go public.
 *
 * The card's acceptance is four nouns — **rename, licences, attribution, `.gitignore` for
 * models** — and each one is a claim about the tree that a stranger can check without trusting
 * the prose around it:
 *
 *   1. **rename** — one identity. `app.json` says `health-viewer`, the package says the same, and
 *      the front page introduces the health map rather than the science viewer the source came
 *      from. A skill routes on `app.json.id`; a human reads the README; the artefact records
 *      `package.json.name`. When they disagree, the same page is three apps.
 *
 *   2. **licences** — this repository is a collection, not a single-licence project: MIT code,
 *      CC BY-SA 4.0 anatomy, CC0 body surface. The texts live in `LICENSES/`, the root `LICENSE`
 *      stays plain MIT so a tool recognises it, and `NOTICE.md` is the path → licence map. A
 *      share-alike licence that is not stated is a redistribution nobody can legally make.
 *
 *   3. **attribution** — the CC BY-SA models must name Z-Anatomy and BodyParts3D wherever they
 *      travel, at an address that answers, and every vendored library must be mapped to the
 *      licence its own package declares — not to a licence text that is assumed to be in a file
 *      header. The credits sit at the root because a redistributor reads the root, not
 *      `body/README.md`.
 *
 *   4. **models** — `body/models/` is content, not build output: the page loads sixteen GLBs and a
 *      fresh clone must render them without a network call. So `.gitignore` keeps rebuild
 *      artefacts out (Blender backups, candidate exports, volume caches) and must never hide a
 *      model the page loads — a hidden model is an empty body and no error. The published
 *      artefact is the other half of the same rule: three files, code only, no models.
 */

const ROOT = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const page = read('body/index.html')

const json = <T>(path: string): T => JSON.parse(read(path)) as T

const git = (args: string[]) =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })

const app = json<{ id: string; title: string }>('app.json')
const pkg = json<{ name: string; version: string; description: string }>('package.json')

/**
 * The models `body/index.html` actually fetches: since T28 `boot()` loads exactly the 3D layer's
 * table (`ANATOMY_FILES`) and nothing else — the body's other four systems are not fetched at all,
 * so the file list is the table, not the layer list.
 */
function shippedModels(): string[] {
  const table = page.slice(page.indexOf('const ANATOMY_FILES = {'), page.indexOf('const ANATOMY_BYTES = {'))
  const files = [...table.matchAll(/\["[a-z]+", "([a-z0-9-]+)", (?:null|"[a-z]+")\]/g)]
    .map((m) => m[1])
  return [...new Set(files)].sort()
}

/**
 * `NOTICE.md` is a table of path → licence → text. These read it as data so the tests can hold the
 * map to something outside itself instead of asking whether some string appears somewhere in it.
 */
function noticeRows(): string[][] {
  return read('NOTICE.md')
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.includes('---'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4)
}

/** The row covering a path; siblings may share one row (`a.js`, `b.js`). */
const noticeRowFor = (path: string) =>
  noticeRows().find((cells) => cells[0].includes(`\`${path}\``))

/** The clause that makes a text *that* licence, so a pointer at the wrong file fails. */
const LICENCE_CLAUSE: Record<string, string> = {
  MIT: 'Permission is hereby granted, free of charge',
  ISC: 'Permission to use, copy, modify, and/or distribute this software',
  CC0: 'Statement of Purpose',
  'CC BY-SA': 'Creative Commons Attribution-ShareAlike 4.0 International Public License',
}

/** The licence a map row names first: `**MIT**, © …` → `MIT`. */
function licenceIn(cell: string): string | undefined {
  const bold = cell.match(/\*\*([^*]+)\*\*/)?.[1] ?? ''
  return Object.keys(LICENCE_CLAUSE).find((name) => bold.startsWith(name))
}

/**
 * The vendored files, the npm package each was copied from, the licence that package declares and
 * the copyright holder that must travel with it. The d3 files are deliberately listed one by one:
 * three of them are ISC (Mike Bostock) and two are MIT (Vasco Asturiano), and a single row for
 * `d3-*.min.js` is exactly how a redistributor ends up carrying the wrong licence.
 */
const VENDORED = [
  { file: 'body/lib/three.min.js', pkg: 'three', licence: 'MIT', holder: 'three.js authors' },
  { file: 'body/lib/OrbitControls.js', pkg: 'three', licence: 'MIT', holder: 'three.js authors' },
  { file: 'body/lib/GLTFLoader.js', pkg: 'three', licence: 'MIT', holder: 'three.js authors' },
  { file: 'body/lib/d3-dispatch.min.js', pkg: 'd3-dispatch', licence: 'ISC', holder: 'Mike Bostock' },
  { file: 'body/lib/d3-quadtree.min.js', pkg: 'd3-quadtree', licence: 'ISC', holder: 'Mike Bostock' },
  { file: 'body/lib/d3-timer.min.js', pkg: 'd3-timer', licence: 'ISC', holder: 'Mike Bostock' },
  { file: 'body/lib/d3-force-3d.min.js', pkg: 'd3-force-3d', licence: 'MIT', holder: 'Vasco Asturiano' },
  { file: 'body/lib/d3-octree.min.js', pkg: 'd3-octree', licence: 'MIT', holder: 'Vasco Asturiano' },
]

/** The pure modules authored here; everything else in `body/lib/` came from somewhere else. */
const OUR_MODULES = new Set(['main-view.js', 'state-list.js', 'timeline-step.js', 'right-panel.js'])

describe('rename: one identity, and it is the health map', () => {
  test('the package is the app, not the science viewer it was copied from', () => {
    expect(app.id).toBe('health-viewer')
    expect(app.title).toBe('Health map')
    expect(pkg.name).toBe(app.id)
    expect(pkg.name).not.toBe('kg-viewer')
    expect(pkg.description.toLowerCase()).toContain('health')
  })

  test('the front page introduces the health map', () => {
    const [heading] = read('README.md').split('\n')
    expect(heading).toMatch(/^# /)
    expect(heading).toContain('Health map')
    expect(heading).not.toContain('kg-viewer')
  })

  test('the built page is titled after the app, not "knowledge graph"', () => {
    const title = read('index.html').match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    expect(title).toContain(app.title)
  })

  test('the release note carries the same name and the same four items', () => {
    const note = read('docs/RELEASE.md')
    expect(note).toContain(`\`${app.id}\``)
    for (const word of ['rename', 'licences', 'attribution', 'models'])
      expect(note.toLowerCase()).toContain(word)
  })
})

describe('licences: a collection, with each part stated', () => {
  test('the root LICENSE is MIT, with the copyright line', () => {
    const licence = read('LICENSE')
    expect(licence).toStartWith('MIT License')
    expect(licence).toContain('Copyright (c) 2026 Denis Tatarenko')
  })

  test('the share-alike and public-domain texts are present, and are the real texts', () => {
    const bySa = read('LICENSES/CC-BY-SA-4.0.txt')
    expect(bySa).toStartWith('Attribution-ShareAlike 4.0 International')
    expect(bySa).toContain('Creative Commons Attribution-ShareAlike 4.0 International Public')
    expect(bySa).toContain('Section 3 -- License Conditions')
    expect(bySa).toContain('ShareAlike')

    const cc0 = read('LICENSES/CC0-1.0.txt')
    expect(cc0).toStartWith('Creative Commons Legal Code')
    expect(cc0).toContain('CC0 1.0 Universal')
    expect(cc0).toContain('Statement of Purpose')

    expect(read('LICENSES/MIT.txt')).toStartWith('MIT License')
  })

  test('the release note points at licence texts that exist', () => {
    // the same defect lives in two files: `NOTICE.md` is the map, `docs/RELEASE.md` is the summary
    // a release reader gets. Both name texts, so both are held to real files.
    const note = read('docs/RELEASE.md')
    const texts = [...note.matchAll(/`(LICENSES\/[^`]+)`/g)].map((m) => m[1])
    expect(texts.length).toBeGreaterThan(2)
    for (const text of texts) expect(existsSync(join(ROOT, text)), `${text} does not exist`).toBe(true)
    // a licence text is a file, not a claim about a file header
    expect(note).not.toContain('header of each file')
  })

  test('NOTICE maps each kind of material to its licence and its text', () => {
    const notice = read('NOTICE.md')
    expect(notice).toContain('MIT')
    expect(notice).toContain('CC BY-SA 4.0')
    expect(notice).toContain('CC0 1.0')
    for (const file of ['LICENSE', 'LICENSES/MIT.txt', 'LICENSES/CC-BY-SA-4.0.txt', 'LICENSES/CC0-1.0.txt'])
      expect(notice).toContain(file)
  })
})

describe('attribution: the credits travel with the models', () => {
  test('Z-Anatomy and BodyParts3D are named, at an address that answers', () => {
    const notice = read('NOTICE.md')
    expect(notice).toContain('Z-Anatomy')
    expect(notice).toContain('https://github.com/Z-Anatomy/Models-of-human-anatomy')
    expect(notice).toContain('BodyParts3D')
    expect(notice).toContain('Database Center for Life Science')
    // The archive's index page for BodyParts3D (`…/bodyparts3d/`) returns 404 as of 2026-11-22;
    // `desc.html` is the page that returns 200, so that is the address the credit carries. Pinning
    // the dead URL instead would make this suite complicit in the dead link rather than a check
    // on it.
    expect(notice).toContain('https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html')
    expect(notice).not.toContain('dbarchive.biosciencedbc.jp/en/bodyparts3d/>')
  })

  test('the CC0 surface names its authors, and the one file with its own notice keeps it', () => {
    const notice = read('NOTICE.md')
    for (const name of ['Dan Ulrich', 'Paul Kotelevets', 'Tonatiuh de San Julián', 'Julien Kaspar'])
      expect(notice).toContain(name)
    expect(notice).toContain('Blender Studio')
    expect(notice).toContain('three.js')
    expect(notice).toContain('d3')
    // of the eight vendored files this is the only one that actually carries a notice; the rest
    // are covered by the texts in `LICENSES/`, which the next test holds to the packages
    expect(read('body/lib/three.min.js')).toContain('SPDX-License-Identifier: MIT')
  })

  test('every vendored file is mapped to the licence its own package declares', () => {
    for (const { file, pkg, licence, holder } of VENDORED) {
      const row = noticeRowFor(file)
      expect(row, `${file}: no row in NOTICE.md`).toBeDefined()
      const cells = row ?? ['', '', '', '']
      expect(licenceIn(cells[2]), `${file}: NOTICE.md names the wrong licence`).toBe(licence)

      // the text cell has to name a file that exists, that is that licence, and that carries the
      // holder — "see the header" is not a notice when the header has no notice in it
      const texts = [...cells[3].matchAll(/`(LICENSES\/[^`]+)`/g)].map((m) => m[1])
      expect(texts.length, `${file}: the map's text cell names no licence text`).toBeGreaterThan(0)
      for (const text of texts) {
        expect(existsSync(join(ROOT, text)), `${text} does not exist`).toBe(true)
        const body = read(text)
        expect(body, `${text} is not a ${licence} text`).toContain(LICENCE_CLAUSE[licence] ?? '\u0000')
        expect(body.toLowerCase(), `${text} does not name ${holder}`).toContain(holder.toLowerCase())
      }

      // …and the package the file came from declares the same licence, so the map cannot drift
      // away from upstream without this failing. Licence only: the vendored three is r146 while
      // the installed one is 0.186.x, so the versions legitimately differ.
      const manifest = `node_modules/${pkg}/package.json`
      expect(existsSync(join(ROOT, manifest)), `${manifest} is missing — run \`bun install\``).toBe(true)
      expect(json<{ license: string }>(manifest).license, `${pkg} declares`).toBe(licence)
      const upstream = read(`node_modules/${pkg}/LICENSE`)
      expect(upstream, `node_modules/${pkg}/LICENSE`).toContain(LICENCE_CLAUSE[licence] ?? '\u0000')
    }
  })

  test('no file vendored into body/lib is left off the map', () => {
    const mapped = new Set(VENDORED.map(({ file }) => file.replace('body/lib/', '')))
    const inLib = readdirSync(join(ROOT, 'body/lib'))
      .filter((name) => name.endsWith('.js') && !OUR_MODULES.has(name))
      .sort()
    expect(inLib).toEqual([...mapped].sort())
  })

  test('the model-specific detail keeps a pointer back to the root notice', () => {
    expect(read('body/README.md')).toContain('../NOTICE.md')
  })
})

describe('models: content the page loads, artefacts beside it', () => {
  const models = shippedModels()

  test('the page loads the ten files of the 3D layer, and they are the published set', () => {
    expect(models).toEqual([
      'bones', 'heart', 'organs', 'reproductive-female', 'reproductive-male', 'skin',
      'skin-female2', 'skinbits-female', 'skinbits2', 'spleen',
    ])
    // T28: the other six files of the atlas — muscles, the two cardio meshes, the two nervous
    // systems and the lymphoid set — are the body's detail, not part of the map, and the page no
    // longer asks for one of them
    for (const other of ['muscles', 'cardio', 'cardio-female', 'nervous', 'nervous-female', 'lymphoid'])
      expect(models).not.toContain(other)
  })

  test('every loaded model exists, is tracked, and is not ignored', () => {
    for (const model of models) {
      const path = `body/models/${model}.glb`
      expect(existsSync(join(ROOT, path))).toBe(true)
      expect(git(['ls-files', '--error-unmatch', path]).status).toBe(0)
      // exit 1 means "no rule ignores this path"; 0 would mean the page is asking for
      // something `.gitignore` hides. `--no-index` is the whole point: a tracked file is
      // never reported as ignored unless the index is left out, so without the flag this
      // check would pass for a rule that hides a shipped model.
      expect(git(['check-ignore', '--no-index', '--quiet', path]).status).toBe(1)
    }
  })

  test('.gitignore keeps rebuild output out, in its own section', () => {
    const ignore = read('.gitignore')
    expect(ignore).toContain('# --- Models')
    for (const rule of ['body/models/**/*.blend1', 'body/models/**/*.npz', 'body/models/**/volume-cache/'])
      expect(ignore).toContain(rule)
  })

  test('the published artefact is code only: three files, none of them a model', () => {
    const release = read('scripts/release.mjs')
    const staged = [...release.matchAll(/\$\{blobFor\(([^)]+)\)\},([^`]+)`/g)].map((m) => m[2].trim())
    expect(staged).toEqual(['viewer.html', 'viewer.version', 'app.json'])
    for (const file of staged) expect(file.endsWith('.glb')).toBe(false)
  })
})
