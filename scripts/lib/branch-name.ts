/**
 * The branch naming rule, as a function.
 *
 * `(fix|feat|chore)/<JIRA-TICKET>_<optional short description>`
 *
 * It lives here, not in the CI YAML, so the same rule can be applied by a worker before it pushes
 * and by CI on the pull request. A rule that only exists in a workflow is discovered after the push.
 */

export const BRANCH_TYPES = ['fix', 'feat', 'chore'] as const
export type BranchType = (typeof BRANCH_TYPES)[number]

/** `main` and `master` are the default branches; nobody opens a pull request whose head is one. */
export const EXEMPT_BRANCHES = new Set(['main', 'master'])

/** `feat/SCRUM-15`, `fix/SCRUM-12_x`, `chore/SCRUM-40_delivery-workflow`. */
const RULE = /^(fix|feat|chore)\/([A-Z][A-Z0-9]*-\d+)(?:_([a-z0-9]+(?:-[a-z0-9]+)*))?$/

/** A description long enough to be a commit message is a description the rule cannot police. */
const MAX_DESCRIPTION = 40

export type BranchCheck =
  | { ok: true; branch: string; exempt: boolean; type: BranchType | null; ticket: string | null; description: string | null }
  | { ok: false; branch: string; reason: string }

export type BranchParts = { type: BranchType; ticket: string; description: string | null }

/** Split a compliant name into its parts; `null` for anything the rule rejects. */
export function parseBranchName(branch: string): BranchParts | null {
  const m = RULE.exec(branch)
  if (!m) return null
  return { type: m[1] as BranchType, ticket: m[2], description: m[3] ?? null }
}

/**
 * Check a branch name and say *why* it fails, in words a worker can act on.
 *
 * The regex alone would answer "no"; a worker needs "the ticket is lower case", "the description
 * needs an underscore", "the description is 96 characters".
 */
export function checkBranchName(branch: string): BranchCheck {
  if (!branch) return { ok: false, branch, reason: 'empty branch name' }

  if (EXEMPT_BRANCHES.has(branch)) {
    return { ok: true, branch, exempt: true, type: null, ticket: null, description: null }
  }

  const slash = branch.indexOf('/')
  if (slash < 0) {
    return {
      ok: false,
      branch,
      reason: `no type prefix: expected one of ${BRANCH_TYPES.join('/')} before "/", e.g. feat/SCRUM-15`,
    }
  }

  const prefix = branch.slice(0, slash)
  if (!(BRANCH_TYPES as readonly string[]).includes(prefix)) {
    return {
      ok: false,
      branch,
      reason: `"${prefix}/" is not one of ${BRANCH_TYPES.join(', ')} — a shared branch or a person's name is not a card branch`,
    }
  }

  const rest = branch.slice(slash + 1)
  if (!rest) return { ok: false, branch, reason: `nothing after "${prefix}/": expected a Jira ticket, e.g. ${prefix}/SCRUM-15` }

  const underscore = rest.indexOf('_')
  const ticketPart = underscore < 0 ? rest : rest.slice(0, underscore)
  const descriptionPart = underscore < 0 ? null : rest.slice(underscore + 1)

  if (!/^[A-Za-z][A-Za-z0-9]*-\d+/.test(ticketPart)) {
    return { ok: false, branch, reason: `"${ticketPart}" is not a Jira ticket: expected <PROJECT>-<number>, e.g. SCRUM-15` }
  }

  const ticketMatch = /^([A-Za-z][A-Za-z0-9]*-\d+)(.*)$/.exec(ticketPart)
  const ticket = ticketMatch?.[1] ?? ticketPart
  const trailer = ticketMatch?.[2] ?? ''

  if (ticket !== ticket.toUpperCase()) {
    return { ok: false, branch, reason: `"${ticket}" is not upper case: Jira keys are upper case, e.g. ${ticket.toUpperCase()}` }
  }

  if (trailer) {
    if (underscore < 0 && /^[a-z0-9-]+$/i.test(trailer)) {
      return {
        ok: false,
        branch,
        reason: `missing "_" between the ticket and the description: ${prefix}/${ticket}_${trailer.replace(/^[-_]+/, '')}`,
      }
    }
    return { ok: false, branch, reason: `"${ticket}${trailer}" is not a Jira ticket followed by "_<description>"` }
  }

  if (descriptionPart !== null) {
    if (!descriptionPart) {
      return { ok: false, branch, reason: 'the "_" is followed by nothing: drop it or name the description' }
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(descriptionPart)) {
      return {
        ok: false,
        branch,
        reason: `"${descriptionPart}" must be lower-case words joined by single hyphens, no spaces, no trailing hyphen`,
      }
    }
    if (descriptionPart.length > MAX_DESCRIPTION) {
      return { ok: false, branch, reason: `the description is ${descriptionPart.length} characters; the limit is ${MAX_DESCRIPTION}` }
    }
  }

  if (!RULE.test(branch)) return { ok: false, branch, reason: `does not match ${BRANCH_TYPES.join('|')}/<JIRA-TICKET>_<optional-short-description>` }

  const parts = parseBranchName(branch)
  if (!parts) return { ok: false, branch, reason: 'does not parse' }
  return { ok: true, branch, exempt: false, ...parts }
}

/** The branch name a card should use: the ticket, plus the card's own short name when it has one. */
export function branchNameFor(type: BranchType, ticket: string, description?: string | null): string {
  const clean = (description ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_DESCRIPTION)
    .replace(/-+$/, '')
  return clean ? `${type}/${ticket.toUpperCase()}_${clean}` : `${type}/${ticket.toUpperCase()}`
}
