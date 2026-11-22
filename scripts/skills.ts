#!/usr/bin/env bun
/**
 * The two export skills ship as `SKILL.md` and nothing else.
 *
 * `kg check --install` fetches `{skills_url}/{name}/SKILL.md` and stops there — a skill that
 * needed a second file would arrive broken. But a PDF writer and a FHIR mapper are code, not
 * prose, so the code lives in both places: a real `.py` in the repo (which the tests run) and a
 * verbatim copy inside the `SKILL.md` (which is what the agent actually receives).
 *
 * Two copies of anything drift. This file is the hinge: `--embed` rewrites the block from the
 * `.py`, and `scripts/skills.test.ts` fails when the block and the `.py` disagree, so the drift
 * is a red test and not a broken skill on someone's machine.
 *
 *   bun scripts/skills.ts            what the blocks currently say
 *   bun scripts/skills.ts --embed    re-copy every .py into its SKILL.md
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type SkillScript = { skill: string; script: string }

/** The skills this app hands to `kg`, and the file each one carries inside its SKILL.md. */
export const SKILL_SCRIPTS: SkillScript[] = [
  { skill: 'markers-to-pdf', script: 'scripts/markers_to_pdf.py' },
  { skill: 'markers-to-fhir', script: 'scripts/markers_to_fhir.py' },
]

const ROOT = join(import.meta.dirname, '..')

export const skillFile = (skill: string) => join(ROOT, 'skills', skill, 'SKILL.md')
export const scriptFile = (skill: string, script: string) => join(ROOT, 'skills', skill, script)

const OPEN = (script: string) =>
  `<!-- script: ${script} — copied from the .py of the same name by ` +
  `\`bun scripts/skills.ts --embed\`; edit the .py, not this block -->`
const CLOSE = '<!-- /script -->'

/**
 * The code block a SKILL.md carries, or `null` when it has none. Throws when the block exists
 * but is malformed — a half-open block is worse than none, because it looks like code.
 */
export function embeddedScript(markdown: string, script: string): string | null {
  const start = markdown.indexOf(`<!-- script: ${script} `)
  if (start === -1) return null
  const bodyStart = markdown.indexOf('```python\n', start)
  if (bodyStart === -1) throw new Error(`${script}: block opens but has no \`\`\`python fence`)
  const bodyEnd = markdown.indexOf('\n```\n', bodyStart)
  if (bodyEnd === -1) throw new Error(`${script}: \`\`\`python fence never closes`)
  const close = markdown.indexOf(CLOSE, bodyEnd)
  if (close === -1) throw new Error(`${script}: block is missing its ${CLOSE} terminator`)
  return markdown.slice(bodyStart + '```python\n'.length, bodyEnd + 1)
}

/** The SKILL.md with its block replaced by the current `.py`. Other text is untouched. */
export function withEmbeddedScript(markdown: string, script: string, code: string): string {
  const existing = embeddedScript(markdown, script)
  const block = `${OPEN(script)}\n\`\`\`python\n${code.replace(/\n+$/, '')}\n\`\`\`\n${CLOSE}`
  if (existing === null) return `${markdown.replace(/\n*$/, '')}\n\n${block}\n`
  const start = markdown.indexOf(`<!-- script: ${script} `)
  const end = markdown.indexOf(CLOSE, start) + CLOSE.length
  return markdown.slice(0, start) + block + markdown.slice(end)
}

function embed(): number {
  let changed = 0
  for (const { skill, script } of SKILL_SCRIPTS) {
    const code = readFileSync(scriptFile(skill, script), 'utf8')
    const path = skillFile(skill)
    const before = readFileSync(path, 'utf8')
    const after = withEmbeddedScript(before, script, code)
    if (after !== before) {
      writeFileSync(path, after)
      changed++
      console.log(`copied ${script} -> skills/${skill}/SKILL.md`)
    } else {
      console.log(`unchanged skills/${skill}/SKILL.md`)
    }
  }
  return changed
}

function report(): number {
  let stale = 0
  for (const { skill, script } of SKILL_SCRIPTS) {
    const markdown = readFileSync(skillFile(skill), 'utf8')
    let embedded: string | null = null
    try {
      embedded = embeddedScript(markdown, script)
    } catch (error) {
      console.error(String(error))
      stale++
      continue
    }
    const code = readFileSync(scriptFile(skill, script), 'utf8').replace(/\n+$/, '')
    if (embedded === null) {
      console.log(`skills/${skill}/SKILL.md carries no block for ${script}`)
      stale++
    } else if (embedded.replace(/\n+$/, '') !== code) {
      console.log(`skills/${skill}/SKILL.md differs from ${script} — run --embed`)
      stale++
    } else {
      console.log(`skills/${skill}/SKILL.md carries ${script} (${code.split('\n').length} lines)`)
    }
  }
  return stale
}

if (import.meta.main) {
  const embedFlag = process.argv.includes('--embed')
  const stale = embedFlag ? embed() : report()
  process.exit(embedFlag || stale === 0 ? 0 : 1)
}
