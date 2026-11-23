/**
 * The reviewer's verdict: the only e2e this repository can honestly gate.
 *
 * GitHub cannot run the skill — the run needs a model, and a model lives here, not on a runner. So
 * the run happens in front of a person (or an agent) who reads the page, and the pipeline checks one
 * thing: that a verdict exists for *this* page and that it says `passed: true`.
 *
 * The verdict cannot name a commit: the commit that carries the verdict has a different sha from the
 * one that was reviewed. It names the **surface** instead — a hash of the files that decide what the
 * page looks like. Adding the verdict does not move the surface, so the verdict stays valid; changing
 * the template, the demo document or the build scripts does, so a stale verdict cannot pass.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

/** What the page is made of. Anything here changes, the reviewer has to look again. */
export const SURFACE_PATHS = ['body', 'src', 'kg_demo.json', 'scripts/build-demo.ts', 'scripts/build-case.ts']

export interface Verdict {
  passed: boolean
  conclusions: string
  surface: string
  reviewer: string
  when: string
  tested_sha?: string
  artifacts?: string[]
}

export interface Judgement {
  ok: boolean
  reason: string
}

/** Hash of the surface at a revision: path plus blob id for every file under SURFACE_PATHS. */
export function surfaceOf(repo: string, rev = 'HEAD'): string {
  const out = execFileSync('git', ['-C', repo, 'ls-tree', '-r', rev, '--', ...SURFACE_PATHS], {
    encoding: 'utf8',
  })
  const lines = out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [meta, path] = line.split('\t')
      const blob = meta.split(' ')[2] ?? ''
      return `${path} ${blob}`
    })
    .sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)
}

export function parseVerdict(raw: string): Verdict | string {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return 'review/verdict.json is not JSON'
  }
  if (typeof value !== 'object' || value === null) return 'review/verdict.json is not an object'
  const v = value as Record<string, unknown>
  if (typeof v.passed !== 'boolean') return 'verdict has no boolean `passed`'
  if (typeof v.conclusions !== 'string' || v.conclusions.trim().length < 20) {
    return 'verdict has no `conclusions` — say what you saw, in a sentence'
  }
  if (typeof v.surface !== 'string' || v.surface === '') return 'verdict has no `surface`'
  return {
    passed: v.passed,
    conclusions: v.conclusions,
    surface: v.surface,
    reviewer: typeof v.reviewer === 'string' ? v.reviewer : 'unknown',
    when: typeof v.when === 'string' ? v.when : '',
    tested_sha: typeof v.tested_sha === 'string' ? v.tested_sha : undefined,
    artifacts: Array.isArray(v.artifacts) ? v.artifacts.filter((a): a is string => typeof a === 'string') : [],
  }
}

export function judge(verdict: Verdict, surface: string, exists: (path: string) => boolean): Judgement {
  if (verdict.surface !== surface) {
    return {
      ok: false,
      reason:
        `the page changed since it was reviewed: verdict covers surface ${verdict.surface}, ` +
        `HEAD is ${surface}. Run the e2e again and record a new verdict.`,
    }
  }
  if (!verdict.passed) {
    return { ok: false, reason: `the reviewer failed this page: ${verdict.conclusions}` }
  }
  for (const artifact of verdict.artifacts ?? []) {
    if (!exists(artifact)) return { ok: false, reason: `verdict names an artifact that is not there: ${artifact}` }
  }
  return { ok: true, reason: `${verdict.reviewer}: ${verdict.conclusions}` }
}
