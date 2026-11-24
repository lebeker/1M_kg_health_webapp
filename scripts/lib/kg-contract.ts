/**
 * The `kg/1` contract, as a checker: base rules for every document, `kg/1-health` for a document
 * whose `meta.app` is `health-viewer`.
 *
 * The declarative half is `scripts/schema/kg-1-health.schema.json` (draft 2020-12, versioned in
 * `x-contract-version`); this file reads it — no copy of the kind list, the relation list or the
 * status list lives here — and adds the rules a JSON Schema cannot state, because they are about
 * other members of the same document:
 *
 *   - an id is unique, and an edge's ends are nodes that exist;
 *   - a node's `source` names a node whose kind is `document` (a document is the provenance and
 *     carries no `source` of its own);
 *   - an edge's ends carry the kinds its relation allows (`x-relations` in the schema);
 *   - a prediction's `target` is a condition or an observation in the same document, and its
 *     `horizon` is not before the date printed on the document it came from;
 *   - only a dated node may carry a validity window, and a window does not end before it starts.
 *
 * The base part stays deliberately thin, because the renderer only needs `nodes[].id` and
 * `edges[].{from,to}`: a research map may carry any other key and the app must not care. The
 * health part is strict, because a health document that invents a kind or forgets a date draws
 * a picture that quietly lies.
 *
 * Source of truth: `docs/DATA-CONTRACT.md` (rev 5) and the renderer's own types in `src/kg.ts`.
 */
import { readFileSync } from 'node:fs'
import { type Issue, validateAgainstSchema } from './json-schema'

export type { Issue }

type Json = Record<string, unknown>

const SCHEMA_URL = new URL('../schema/kg-1-health.schema.json', import.meta.url)

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** The contract itself, as the file says it. Exported so a test can hold the two halves together. */
export const HEALTH_SCHEMA = JSON.parse(readFileSync(SCHEMA_URL, 'utf8')) as Json

export const HEALTH_SCHEMA_VERSION = String(HEALTH_SCHEMA['x-contract-version'] ?? '')

function definition(name: string): Json {
  const defs = isObject(HEALTH_SCHEMA.$defs) ? HEALTH_SCHEMA.$defs : {}
  const found = defs[name]
  if (!isObject(found)) throw new Error(`scripts/schema/kg-1-health.schema.json has no $defs.${name}`)
  return found
}

function declared(def: Json, name: string): Json {
  const properties = isObject(def.properties) ? def.properties : {}
  const found = properties[name]
  if (!isObject(found)) throw new Error(`scripts/schema/kg-1-health.schema.json declares no property "${name}"`)
  return found
}

function strings(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`scripts/schema/kg-1-health.schema.json: ${what} must be an array of strings`)
  }
  return value as readonly string[]
}

const NODE = definition('node')
const EDGE = definition('edge')

/** The eight kinds, six of them events, and no free-form ones: the template has a layout for each and nothing for the rest. */
export const HEALTH_KINDS = strings(declared(NODE, 'kind').enum, '$defs.node.properties.kind.enum')

/** The kind that is the provenance: every `source` points at one, and the document points at none. */
const PROVENANCE_KIND = 'document'

const NODE_BRANCHES = Array.isArray(NODE.oneOf) ? NODE.oneOf.filter(isObject) : []

const branchKind = (branch: Json): string => {
  const kind = isObject(branch.properties) && isObject(branch.properties.kind) ? branch.properties.kind.const : undefined
  return typeof kind === 'string' ? kind : ''
}

function branchFor(kind: string): Json {
  const found = NODE_BRANCHES.find((branch) => branchKind(branch) === kind)
  if (!found) throw new Error(`scripts/schema/kg-1-health.schema.json has no $defs.node branch for kind "${kind}"`)
  return found
}

/**
 * Kinds that are events: visible on the timeline by their own date, and named by T06 — condition,
 * observation, encounter, medication, procedure, document. The branch is where the schema says so:
 * an event's branch requires `when`, and "cannot be created without a date" starts here.
 *
 * The one kind that requires `when` without being an event is the summary: it carries the date it
 * marks, because a marker that cannot be placed is useless, but rev 4 says a summary is virtual and
 * "not an event somebody recorded" — the player never steps to it as one.
 */
const MARKER_KINDS: readonly string[] = ['summary']

export const HEALTH_EVENT_KINDS = NODE_BRANCHES.filter(
  (branch) => Array.isArray(branch.required) && branch.required.includes('when'),
)
  .map(branchKind)
  .filter((kind) => !MARKER_KINDS.includes(kind))

/**
 * Kinds whose own existence is dated in a way a validity window can express. A window is a relation's
 * device: a thing that holds between two dates (a condition, a medication, a projection) may carry
 * one, and a document may not — the date on a document is the date it was written, not a period it
 * was in force for. The line between the two is DATA-CONTRACT §Temporal rule.
 */
export const TEMPORAL_NODE_KINDS = [...HEALTH_EVENT_KINDS.filter((kind) => kind !== 'document'), 'prediction'] as const

// The event list and the branches are two statements of one fact: an event is a branch that requires
// `when`, minus the virtual markers. A document is the one event without `source`, because the
// document is the provenance itself. The list grows with the record — immunization, device and
// allergy joined it — so the count is not pinned; the two statements are checked against each other
// in src/events.test.ts, which is where a drift becomes a failing test instead of a surprise.
if (HEALTH_EVENT_KINDS.length < 6) {
  throw new Error(
    `scripts/schema/kg-1-health.schema.json: the branches require \`when\` on only ${HEALTH_EVENT_KINDS.length} kinds (${HEALTH_EVENT_KINDS.join(', ')}), fewer than the six the record has always had`,
  )
}
for (const kind of HEALTH_EVENT_KINDS) {
  const required = strings(branchFor(kind).required, `$defs.node[${kind}].required`)
  if (kind === 'document' && required.includes('source')) {
    throw new Error(
      'scripts/schema/kg-1-health.schema.json: a document is the provenance, so its branch may not require `source` (DATA-CONTRACT §Node kinds)',
    )
  }
  if (kind !== 'document' && !required.includes('source')) {
    throw new Error(
      `scripts/schema/kg-1-health.schema.json: ${kind} is an event, so its branch must require the \`source\` document it came from (DATA-CONTRACT §Node kinds)`,
    )
  }
}

export const CONDITION_STATUS = strings(
  declared(branchFor('condition'), 'status').enum,
  '$defs.node[condition].properties.status.enum',
)
export const OBSERVATION_FLAGS = strings(
  declared(branchFor('observation'), 'flag').enum,
  '$defs.node[observation].properties.flag.enum',
)

/**
 * The six fields a prediction cannot do without, read off the schema's prediction branch so the
 * list has one home. The card T18 names exactly these: a forecast that is missing any of them is
 * either not about anything, not about any date, not waiting on anything, or not changing anything
 * — and the last two are how a simulation gets mistaken for a fact.
 */
export const PREDICTION_REQUIRED = strings(
  branchFor('prediction').required,
  '$defs.node[prediction].required',
)

const RELATIONS = isObject(HEALTH_SCHEMA['x-relations']) ? HEALTH_SCHEMA['x-relations'] : {}

/** The closed relation list: relation → which kinds may sit on each end. `*` is "any". */
export const HEALTH_EDGE_LABELS: Record<string, { from: readonly string[]; to: readonly string[] }> =
  Object.fromEntries(
    Object.entries(RELATIONS).map(([label, rule]) => {
      if (!isObject(rule)) throw new Error(`scripts/schema/kg-1-health.schema.json: x-relations.${label} is not an object`)
      return [label, { from: strings(rule.from, `x-relations.${label}.from`), to: strings(rule.to, `x-relations.${label}.to`) }]
    }),
  )

// The label list and the endpoint table are two statements of one fact; a document may not pass
// one and fail the other, so the file is refused at load rather than drifting quietly.
const LABEL_ENUM = strings(declared(EDGE, 'label').enum, '$defs.edge.properties.label.enum')
if (LABEL_ENUM.join(',') !== Object.keys(HEALTH_EDGE_LABELS).join(',')) {
  throw new Error(
    `scripts/schema/kg-1-health.schema.json: $defs.edge.properties.label.enum and x-relations disagree (${LABEL_ENUM.join(', ')} vs ${Object.keys(HEALTH_EDGE_LABELS).join(', ')})`,
  )
}

const BASE_TOP_LEVEL = new Set(['meta', 'nodes', 'edges'])

/**
 * Kinds a prediction may be about. Read off the `projected` relation rather than copied: the edge
 * and the node's `target` say one thing, and a document may not have them disagree.
 */
export const PREDICTION_TARGET_KINDS: readonly string[] = HEALTH_EDGE_LABELS.projected?.to ?? []

const isHealthDocument = (doc: Json): boolean => isObject(doc.meta) && doc.meta.app === 'health-viewer'

/** Validate one parsed document. An empty array means it conforms. */
export function validateKg(doc: unknown): Issue[] {
  if (!isObject(doc)) return [{ path: '$', message: 'the document is not a JSON object' }]

  if (isHealthDocument(doc)) {
    const issues = relabelToIds(validateAgainstSchema(doc, HEALTH_SCHEMA), doc)
    issues.push(...crossReferences(doc, true))
    return dedupe(issues)
  }

  const issues = validateBase(doc)
  issues.push(...crossReferences(doc, false))
  return dedupe(issues)
}

/** The base kg/1 shape: an envelope, an id per node, an existing node at both ends of an edge. */
function validateBase(doc: Json): Issue[] {
  const issues: Issue[] = []

  for (const key of Object.keys(doc)) {
    if (!BASE_TOP_LEVEL.has(key)) {
      issues.push({ path: `$.${key}`, message: 'unknown top-level key; a kg/1 document is meta, nodes, edges' })
    }
  }

  if (!isObject(doc.meta)) {
    issues.push({ path: '$.meta', message: 'missing meta object' })
  } else {
    const meta = doc.meta
    if (!isNonEmptyString(meta.title)) issues.push({ path: '$.meta.title', message: 'missing title' })
    if (meta.schema !== 'kg/1') {
      issues.push({ path: '$.meta.schema', message: `schema must be "kg/1", found ${JSON.stringify(meta.schema)}` })
    }
    if (!isNonEmptyString(meta.app)) issues.push({ path: '$.meta.app', message: 'missing app id' })
  }

  const nodes = Array.isArray(doc.nodes) ? doc.nodes : undefined
  const edges = Array.isArray(doc.edges) ? doc.edges : undefined
  if (!nodes) issues.push({ path: '$.nodes', message: 'nodes must be an array' })
  if (!edges) issues.push({ path: '$.edges', message: 'edges must be an array' })

  nodes?.forEach((node, index) => {
    const path = `$.nodes[${index}]`
    if (!isObject(node)) {
      issues.push({ path, message: 'node is not an object' })
      return
    }
    if (!isNonEmptyString(node.id)) issues.push({ path: `${path}.id`, message: 'node has no id' })
    if (node.label !== undefined && typeof node.label !== 'string') {
      issues.push({ path: `${path}.label`, message: 'label must be a string' })
    }
  })

  edges?.forEach((edge, index) => {
    const path = `$.edges[${index}]`
    if (!isObject(edge)) {
      issues.push({ path, message: 'edge is not an object' })
      return
    }
    // An edge is two ids and nothing else is promised (src/kg.ts): with no `to` it is not a
    // relation, and the renderer drops it without a word, so this is the only place that says so.
    for (const end of ['from', 'to'] as const) {
      if (!isNonEmptyString(edge[end])) issues.push({ path: `${path}.${end}`, message: `edge has no ${end}` })
    }
    if (edge.label !== undefined && typeof edge.label !== 'string') {
      issues.push({ path: `${path}.label`, message: 'label must be a string' })
    }
  })

  return issues
}

/**
 * What one member of the document owes another. `health` turns on the rules that only make sense
 * once the kinds are closed and every fact has a provenance.
 */
function crossReferences(doc: Json, health: boolean): Issue[] {
  const issues: Issue[] = []
  const nodes = Array.isArray(doc.nodes) ? doc.nodes.filter(isObject) : []
  const edges = Array.isArray(doc.edges) ? doc.edges.filter(isObject) : []

  const byId = new Map<string, Json>()
  nodes.forEach((node, index) => {
    if (!isNonEmptyString(node.id)) return
    if (byId.has(node.id)) {
      issues.push({ path: `$.nodes[${index}].id`, message: `duplicate node id "${node.id}"` })
      return
    }
    byId.set(node.id, node)
  })

  edges.forEach((edge, index) => {
    const path = `$.edges[${index}]`
    for (const end of ['from', 'to'] as const) {
      const value = edge[end]
      if (!isNonEmptyString(value)) continue // an absent or blank end is reported by the schema ($defs.nonEmptyText), or by validateBase on the base path
      if (!byId.has(value)) {
        issues.push({ path: `${path}.${end}`, message: `edge points at "${value}", which is not a node in this document` })
      }
    }
  })

  if (!health) return issues

  for (const [id, node] of byId) {
    const path = `$.nodes[${id}]`
    const kind = typeof node.kind === 'string' ? node.kind : ''

    // Two sentences for a blank `source`, on purpose: the schema states the rule ($defs.nonEmptyText)
    // and this says what the lookup did with it — an id of spaces names nothing, so there is nothing
    // to resolve, and a check that quietly resolves nothing is how a fact ends up citing a document
    // that is not there. A blank and a well-formed id that points at no node read differently.
    if (kind !== PROVENANCE_KIND && node.source !== undefined) {
      if (typeof node.source === 'string' && !isNonEmptyString(node.source)) {
        issues.push({
          path: `${path}.source`,
          message: `source is blank — a node that names no document cannot be traced to one`,
        })
      } else if (isNonEmptyString(node.source)) {
        const parent = byId.get(node.source)
        if (!parent) {
          issues.push({ path: `${path}.source`, message: `source "${node.source}" is not a node in this document` })
        } else if (parent.kind !== PROVENANCE_KIND) {
          issues.push({
            path: `${path}.source`,
            message: `"${node.source}" is a ${String(parent.kind)} node, not a document`,
          })
        }
      }
    }

    if (kind === 'prediction') issues.push(...predictionProblems(node, path, byId))

    const window = validityWindow(node)
    if (window !== undefined) {
      if (!(TEMPORAL_NODE_KINDS as readonly string[]).includes(kind)) {
        issues.push({
          path: `${path}.${window.field}`,
          message: `${window.field} on a non-temporal node: a ${kind || 'node'} does not hold between two dates, so it has no validity window — its own date goes in when, and a relation's window goes on the edge`,
        })
      }
      const reversed = reversedWindow(window)
      if (reversed !== undefined) issues.push({ path, message: reversed })
    }
  }

  edges.forEach((edge, index) => {
    const path = `$.edges[${index}]`
    if (edge.source !== undefined) {
      if (typeof edge.source === 'string' && !isNonEmptyString(edge.source)) {
        issues.push({
          path: `${path}.source`,
          message: 'source is blank — a relation that names no document cannot be traced to one',
        })
      } else if (isNonEmptyString(edge.source)) {
        const parent = byId.get(edge.source)
        if (!parent) {
          issues.push({ path: `${path}.source`, message: `edge source "${edge.source}" is not a node in this document` })
        } else if (parent.kind !== PROVENANCE_KIND) {
          issues.push({
            path: `${path}.source`,
            message: `edge source "${edge.source}" is a ${String(parent.kind)} node, not a document`,
          })
        }
      }
    }

    const reversed = reversedWindow(validityWindow(edge))
    if (reversed !== undefined) issues.push({ path, message: reversed })

    const label = edge.label
    const rule = isNonEmptyString(label) ? HEALTH_EDGE_LABELS[label] : undefined
    if (!rule) return // the schema says which relations exist
    const from = isNonEmptyString(edge.from) ? byId.get(edge.from) : undefined
    const to = isNonEmptyString(edge.to) ? byId.get(edge.to) : undefined
    if (!from || !to) return
    if (!rule.from.includes('*') && !rule.from.includes(String(from.kind))) {
      issues.push({
        path: `${path}.from`,
        message: `${label} starts at ${String(from.kind)}, expected ${rule.from.join(' or ')}`,
      })
    }
    if (!rule.to.includes('*') && !rule.to.includes(String(to.kind))) {
      issues.push({ path: `${path}.to`, message: `${label} ends at ${String(to.kind)}, expected ${rule.to.join(' or ')}` })
    }
  })

  return issues
}

/**
 * What a prediction owes the rest of the document, beyond the fields the schema already types:
 *
 *   - its `target` is a node here, and one of the kinds it may project onto (a condition or an
 *     observation) — a forecast about a document or a medication names a thing that cannot carry
 *     the outcome it claims;
 *   - its `horizon` is not before the date printed on the document it came from. A forecast is made
 *     on a date and is about a later one; one that looks back is a record with a forecast's clothes.
 *
 * The condition itself is checked by the schema (`$defs.predicate`), and whether it is *met* is not a
 * question about the document at all — that is `src/prediction.ts`, which never lets an unmet or
 * undecidable condition move an estimate.
 */
function predictionProblems(node: Json, path: string, byId: Map<string, Json>): Issue[] {
  const issues: Issue[] = []

  if (isNonEmptyString(node.target)) {
    const target = byId.get(node.target)
    if (!target) {
      issues.push({ path: `${path}.target`, message: `target "${node.target}" is not a node in this document` })
    } else if (!PREDICTION_TARGET_KINDS.includes(String(target.kind))) {
      issues.push({
        path: `${path}.target`,
        message: `target "${node.target}" is a ${String(target.kind)} node, expected ${PREDICTION_TARGET_KINDS.join(' or ')}: a prediction is about an outcome, not about the paper it cites`,
      })
    }
  }

  const horizon = node.horizon
  const made = isNonEmptyString(node.source) ? startOf(byId.get(node.source)?.when) : undefined
  if (typeof horizon === 'string' && made !== undefined && horizon < made) {
    issues.push({
      path: `${path}.horizon`,
      message: `horizon ${horizon} is before ${made}, the date printed on the document it came from: a forecast is about a later date, never an earlier one`,
    })
  }

  return issues
}

/** The start of a `when`: a date, or the `from` of an interval. */
function startOf(when: unknown): string | undefined {
  if (typeof when === 'string') return when
  if (isObject(when) && typeof when.from === 'string') return when.from
  return undefined
}

type Window = { field: string; from: string; to?: string | null }

function validityWindow(holder: Json): Window | undefined {
  const from = holder.valid_from
  const to = holder.valid_to
  if (from === undefined && to === undefined) return undefined
  return {
    field: from !== undefined ? 'valid_from' : 'valid_to',
    from: typeof from === 'string' ? from : '',
    to: typeof to === 'string' || to === null ? to : undefined,
  }
}

function reversedWindow(window: Window | undefined): string | undefined {
  if (window === undefined) return undefined
  if (window.from === '' || typeof window.to !== 'string') return undefined
  if (window.to >= window.from) return undefined
  return `valid_to ${window.to} is before valid_from ${window.from}: a window that ends before it starts never holds`
}

/**
 * Schema issues address a node by its index, because that is where the value is. A reader knows
 * the card by its id. Rename the index when the id is unambiguous — a duplicated id stays at its
 * index, so the two rows that collide do not both print the same path.
 */
function relabelToIds(issues: Issue[], doc: Json): Issue[] {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : []
  const ids = nodes.map((node) => (isObject(node) && isNonEmptyString(node.id) ? node.id : undefined))
  const counts = new Map<string, number>()
  for (const id of ids) if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1)

  return issues.map((issue) => {
    const match = /^\$\.nodes\[(\d+)\]/.exec(issue.path)
    if (!match) return issue
    const index = Number(match[1])
    const id = ids[index]
    if (id === undefined || (counts.get(id) ?? 0) > 1) return issue
    return { ...issue, path: issue.path.replace(`$.nodes[${index}]`, `$.nodes[${id}]`) }
  })
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.path}\u0000${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
