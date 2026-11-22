/**
 * The CI half of the e2e gate: does this pull request have a receipt?
 *
 * GitHub never runs an agent — a check that needs a model is not a check — so CI does not try to
 * produce G3 evidence. It asks for the receipt instead: `run.ts` posts one commit status,
 * `e2e`, on the exact head it captured, and this step requires that status to be `success` on
 * this pull request's head when the diff touches the app surface. Since `verify` is a required
 * check on `main`, a product branch without a green run cannot merge, and a card cannot honestly
 * complete.
 *
 * The step polls: a worker pushes, runs e2e against the pushed head, and the status lands a few
 * minutes later. Failing the build in that window would make the gate a race with the workflow
 * rather than a record of the run, so it waits (ten minutes by default) and fails only after.
 *
 * The diff decides, not a card's prose: `appSurface()` is the same list the card template and the
 * gate use, so a docs or tooling branch is exempt without anybody remembering to exempt it. The
 * diff also decides which *page* the receipt has to be evidence of (`pagesFor`): a `body/` change
 * needs a run that opened the columns page, and the receipt says which pages it opened in its
 * description. Before that, a graph-page run was a green light for a columns-page change — the
 * exact receipt t_7557a1f2 proved was an infrastructure smoke rather than a test of the claim.
 *
 * Both ends of that diff are required. A pull request that names no head or no base is a usage
 * error, not an empty diff: `appSurface([])` is empty, so a missing diff used to read as
 * "nothing moved the product" and passed the gate it was supposed to be. The non-pull-request
 * return stays a pass on purpose — a push on main is not a merge, and `verify.yml` gates the step.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { PAGE_KINDS, type PageKind } from './card'
import { appSurface, pagesFor } from './gate'
import { E2E_STATUS_CONTEXT } from './status'

export type StatusEntry = { context?: string; state?: string; description?: string; created_at?: string }

/** The newest status for the `e2e` context, or `null` when nothing posted one. */
export function latestE2eStatus(statuses: StatusEntry[]): { state: string; description: string } | null {
  const matching = statuses
    .filter((entry) => entry.context === E2E_STATUS_CONTEXT)
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const newest = matching[matching.length - 1]
  if (!newest) return null
  return { state: String(newest.state ?? ''), description: String(newest.description ?? '') }
}

/**
 * The pages a receipt says it opened: `run.ts` writes `G3 [case] …` or `G3 [case+graph] …` into
 * the status description. An old receipt has no marker and is read as "unnamed", which is not the
 * same as "the case page": the marker is the only way a reader can tell the two apart.
 */
export function receiptPages(description: string): PageKind[] | null {
  const match = description.match(/\[\s*(case|graph|both)((?:\s*[+,]\s*(?:case|graph|both))+)?\s*\]/i)
  if (!match) return null
  const tokens = `${match[1]}${match[2] ?? ''}`
    .toLowerCase()
    .split(/[+,]/)
    .map((token) => token.trim())
    .filter(Boolean)
  const named = new Set<PageKind>()
  for (const token of tokens) {
    if (token === 'both') {
      named.add('case')
      named.add('graph')
    } else if (token === 'case' || token === 'graph') named.add(token)
  }
  return PAGE_KINDS.filter((kind) => named.has(kind))
}

export type Decision = { required: boolean; ok: boolean; message: string }

/**
 * The verdict for one look at the pull request. `pending` and `null` are not verdicts — the
 * caller polls — except at the deadline, where both become the same failure.
 *
 * A green receipt is not enough on its own: it has to be evidence of the page this diff moves.
 * The graph page was the only page a run could open when this gate was written, so an unmarked
 * receipt still satisfies a graph-only diff; a diff that moves the columns page needs a receipt
 * that says it opened the columns page, because otherwise a run against a page the card never
 * mentioned is what lets a `body/` pull request merge.
 */
export function decide(input: { event: string; files: string[]; status: { state: string; description: string } | null }): Decision {
  if (input.event !== 'pull_request') {
    return { required: false, ok: true, message: 'not a pull request — the e2e gate applies to merges, not to pushes on main' }
  }
  const surface = appSurface(input.files)
  if (surface.length === 0) {
    return { required: false, ok: true, message: 'no app-surface files in this diff, so no clean-room run is required' }
  }
  const needed = pagesFor(input.files)
  const moved = surface.map((hit) => `${hit.path} (${hit.area})`).slice(0, 6)
  if (!input.status) {
    return {
      required: true,
      ok: false,
      message: `this diff moves the app surface — ${moved.join('; ')} — and no e2e run was recorded against this head`,
    }
  }
  if (input.status.state === 'success') {
    const named = receiptPages(input.status.description)
    // `case` can never be assumed: no run before this gate existed opened that page, so an
    // unmarked receipt is a graph-page run. `graph` is assumed from an unmarked receipt, which is
    // what every older green status is, but a receipt that names pages and leaves the graph out
    // does not cover a diff that moves the graph view.
    const missing = needed.filter((kind) => (named === null ? kind === 'case' : !named.includes(kind)))
    if (missing.length > 0) {
      return {
        required: true,
        ok: false,
        message: `the e2e receipt on this head is green but it is not evidence of ${missing
          .map((kind) => (kind === 'case' ? 'the columns page (dist/demo.html)' : 'the graph page (dist/graph.html)'))
          .join(' and ')}, and this diff moves it — ${moved.join('; ')}. ${named === null ? 'The receipt names no page, so it was a graph-page run.' : `The receipt names ${named.join('+')} only.`} Run e2e against this head with \`page: case\` in the card's ## e2e block.`,
      }
    }
    return { required: true, ok: true, message: `e2e run recorded against this head: ${input.status.description || '(no description)'}` }
  }
  if (input.status.state === 'pending') {
    return { required: true, ok: false, message: `an e2e run is still in flight: ${input.status.description}` }
  }
  return {
    required: true,
    ok: false,
    message: `the e2e run against this head ${input.status.state === 'failure' ? 'failed' : 'did not finish'}: ${input.status.description}`,
  }
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function changedFiles(base: string, head: string): string[] {
  return git(['diff', '--name-only', base, head])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function statuses(repo: string, sha: string, token: string): Promise<StatusEntry[]> {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repo}@${sha.slice(0, 7)} statuses`)
  return (await response.json()) as StatusEntry[]
}

function say(message: string) {
  console.log(message)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  try {
    appendFileSync(summary, `\n### ${message.split('\n')[0]}\n\n${message}\n`)
  } catch {
    // the summary is a nicety; the log above is the record
  }
}

async function main(argv: string[]): Promise<number> {
  let head = process.env.E2E_HEAD_SHA ?? ''
  let base = process.env.E2E_BASE_SHA ?? ''
  let repo = process.env.GITHUB_REPOSITORY ?? ''
  let timeout = Number(process.env.E2E_GATE_TIMEOUT ?? 600)
  let interval = Number(process.env.E2E_GATE_INTERVAL ?? 15)
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      const value = argv[i]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      return value
    }
    if (arg === '--head') head = next()
    else if (arg === '--base') base = next()
    else if (arg === '--repo') repo = next()
    else if (arg === '--timeout') timeout = Number(next())
    else if (arg === '--interval') interval = Number(next())
    else throw new Error(`unknown argument ${arg}`)
  }

  const event = process.env.GITHUB_EVENT_NAME ?? 'local'

  // A pull request is judged by its diff, so both ends of it are required. Handing `[]` to
  // `decide()` here would read "I have no diff" as "the diff is empty" and exempt the branch.
  if (event === 'pull_request' && (!head || !base)) {
    const missing = [head ? '' : '--head (E2E_HEAD_SHA)', base ? '' : '--base (E2E_BASE_SHA)'].filter(Boolean)
    console.error(
      `a pull request needs both ends of the diff, and ${missing.join(' and ')} ${missing.length > 1 ? 'were' : 'was'} not given`,
    )
    return 1
  }

  // Not a pull request: a push on main is not a merge and carries no diff to judge. `verify.yml`
  // gates the step to `pull_request`; this return is what a local invocation sees.
  if (!head || !base) {
    say(decide({ event, files: [], status: null }).message)
    return 0
  }

  const files = changedFiles(base, head)

  if (event !== 'pull_request') {
    say(decide({ event, files, status: null }).message)
    return 0
  }

  const surface = appSurface(files)
  if (surface.length === 0) {
    say(decide({ event, files, status: null }).message)
    return 0
  }

  const token = process.env.GITHUB_TOKEN ?? ''
  if (!token) {
    say('no GITHUB_TOKEN in the environment, so the e2e receipt cannot be read — refusing rather than passing')
    return 1
  }

  const deadline = Date.now() + timeout * 1000
  let last: Decision = decide({ event, files, status: null })
  for (;;) {
    let entry: { state: string; description: string } | null = null
    try {
      entry = latestE2eStatus(await statuses(repo, head, token))
    } catch (error) {
      say(`could not read the e2e receipt: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    last = decide({ event, files, status: entry })
    if (entry && entry.state !== 'pending') break
    if (Date.now() >= deadline) {
      if (!entry) last = decide({ event, files, status: null })
      break
    }
    console.log(`waiting for the e2e run against ${head.slice(0, 7)} (${entry ? entry.description : 'no receipt yet'})`)
    await new Promise((resolve) => setTimeout(resolve, interval * 1000))
  }

  if (last.ok) {
    say(last.message)
    return 0
  }
  say(
    [
      last.message,
      '',
      'A green `e2e` status is posted only by a clean-room run against this exact commit:',
      '',
      '```sh',
      `git rev-parse HEAD   # must be ${head}`,
      `bun run e2e --card <task-id>`,
      '```',
      '',
      'The run builds this head, gives a fresh agent one sentence from the card, captures the page',
      "it renders in Hermes' own browser, replays its document in this build, and attaches the",
      'evidence to the card. It exits non-zero when the card\'s claim is not visible, and a red run',
      'posts no success. Do not post this status by hand: it is the receipt for evidence, not a tick.',
      '',
      'A card whose claim lives on the columns page must say `page: case` in its `## e2e` block:',
      'the receipt names the pages it opened (`[case]`, `[graph]`, `[case+graph]`), and a run that',
      'never opened the page this diff moves is not a receipt for it.',
    ].join('\n'),
  )
  return 1
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
