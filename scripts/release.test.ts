import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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
 *      travel, and the vendored libraries keep their own notices. The credits sit at the root
 *      because a redistributor reads the root, not `body/README.md`.
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

/** The models `body/index.html` actually fetches: the layer rows plus the loose `loadFile` calls. */
function shippedModels(): string[] {
  const layers = page.slice(page.indexOf('const LAYERS = ['), page.indexOf('const state = {'))
  const rows = [...layers.matchAll(/\{ id:"([a-z-]+)"[^\n]*/g)]
    .filter((m) => !m[0].includes('filesBySex'))
    .map((m) => m[1])
  // `loadFile(id, file, variant?)` — the file is the second argument, and a layer without an
  // explicit `files` list loads a GLB named after its id.
  const loose = [...page.matchAll(/loadFile\(\s*"[a-z-]+",\s*"([a-z0-9-]+)"/g)].map((m) => m[1])
  return [...new Set([...rows, ...loose])].sort()
}

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
  test('Z-Anatomy and BodyParts3D are named, with where to find them', () => {
    const notice = read('NOTICE.md')
    expect(notice).toContain('Z-Anatomy')
    expect(notice).toContain('https://github.com/Z-Anatomy/Models-of-human-anatomy')
    expect(notice).toContain('BodyParts3D')
    expect(notice).toContain('Database Center for Life Science')
    expect(notice).toContain('https://dbarchive.biosciencedbc.jp/en/bodyparts3d/')
  })

  test('the CC0 surface names its authors, and the vendored libraries keep their notices', () => {
    const notice = read('NOTICE.md')
    for (const name of ['Dan Ulrich', 'Paul Kotelevets', 'Tonatiuh de San Julián', 'Julien Kaspar'])
      expect(notice).toContain(name)
    expect(notice).toContain('Blender Studio')
    expect(notice).toContain('three.js')
    expect(notice).toContain('d3')
    // the files themselves still carry the notices the notice points at
    expect(read('body/lib/three.min.js')).toContain('SPDX-License-Identifier: MIT')
    expect(read('body/lib/d3-quadtree.min.js')).toContain('Mike Bostock')
    expect(read('body/lib/d3-force-3d.min.js')).toContain('vasturiano/d3-force-3d')
  })

  test('the model-specific detail keeps a pointer back to the root notice', () => {
    expect(read('body/README.md')).toContain('../NOTICE.md')
  })
})

describe('models: content the page loads, artefacts beside it', () => {
  const models = shippedModels()

  test('the page loads sixteen models, and they are the published set', () => {
    expect(models).toEqual([
      'bones', 'cardio', 'cardio-female', 'heart', 'lymphoid', 'muscles', 'nervous',
      'nervous-female', 'organs', 'reproductive-female', 'reproductive-male', 'skin',
      'skin-female2', 'skinbits-female', 'skinbits2', 'spleen',
    ])
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
