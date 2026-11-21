/**
 * The `kg/1` contract, as a checker — base rules for every document, health rules for a document
 * whose `meta.app` is `health-viewer`.
 *
 * Source of truth: `docs/DATA-CONTRACT.md` (rev 5) and the renderer's own types in `src/kg.ts`.
 * The base part is deliberately thin, because the renderer only needs `nodes[].id` and
 * `edges[].{from,to}`: a research map may carry any other key and the app must not care. The health
 * part is strict, because a health document that invents a kind or forgets a date draws a picture
 * that quietly lies.
 *
 * T04 owns the JSON Schema version of this (`kg/1-health`). When it lands, it replaces this
 * implementation behind the same command — `bun run test:contract` — so CI does not move.
 */

export type Issue = { path: string; message: string }

export const HEALTH_KINDS = [
  'condition',
  'observation',
  'encounter',
  'medication',
  'summary',
  'prediction',
  'source',
] as const

/** Kinds that carry a date in `when`. A `source` and a `prediction` have their own dates. */
export const HEALTH_EVENT_KINDS = ['condition', 'observation', 'encounter', 'medication', 'summary'] as const

export const CONDITION_STATUS = ['active', 'resolved', 'suspected', 'stopped'] as const
export const OBSERVATION_FLAGS = ['low', 'normal', 'high', 'critical'] as const

/** The closed relation list: relation → which kinds may sit on each end. `*` is "any". */
export const HEALTH_EDGE_LABELS: Record<string, { from: readonly string[]; to: readonly string[] }> = {
  tracks: { from: ['observation'], to: ['condition'] },
  treated_by: { from: ['condition'], to: ['medication'] },
  contradicts: { from: ['observation'], to: ['condition'] },
  preceded_by: { from: [...HEALTH_EVENT_KINDS], to: [...HEALTH_EVENT_KINDS] },
  derived_from: { from: ['*'], to: ['source'] },
  advised: { from: ['encounter'], to: ['medication', 'observation'] },
  projected: { from: ['prediction'], to: ['condition', 'observation'] },
  part_of: { from: ['observation'], to: ['observation'] },
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/
const TOP_LEVEL_KEYS = new Set(['meta', 'nodes', 'edges'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const isHealthDocument = (doc: Record<string, unknown>): boolean => {
  const meta = doc.meta
  return isObject(meta) && meta.app === 'health-viewer'
}

/** Validate one parsed document. An empty array means it conforms. */
export function validateKg(doc: unknown): Issue[] {
  const issues: Issue[] = []

  if (!isObject(doc)) {
    return [{ path: '$', message: 'the document is not a JSON object' }]
  }

  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push({ path: `$.${key}`, message: 'unknown top-level key; a kg/1 document is meta, nodes, edges' })
    }
  }

  const meta = doc.meta
  if (!isObject(meta)) {
    issues.push({ path: '$.meta', message: 'missing meta object' })
  } else {
    if (!isNonEmptyString(meta.title)) issues.push({ path: '$.meta.title', message: 'missing title' })
    if (meta.schema !== 'kg/1') {
      issues.push({ path: '$.meta.schema', message: `schema must be "kg/1", found ${JSON.stringify(meta.schema)}` })
    }
    if (!isNonEmptyString(meta.app)) issues.push({ path: '$.meta.app', message: 'missing app id' })
  }

  const nodes = doc.nodes
  const edges = doc.edges
  if (!Array.isArray(nodes)) issues.push({ path: '$.nodes', message: 'nodes must be an array' })
  if (!Array.isArray(edges)) issues.push({ path: '$.edges', message: 'edges must be an array' })
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return issues

  const byId = new Map<string, Record<string, unknown>>()
  nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`
    if (!isObject(node)) {
      issues.push({ path, message: 'node is not an object' })
      return
    }
    if (!isNonEmptyString(node.id)) {
      issues.push({ path: `${path}.id`, message: 'node has no id' })
      return
    }
    if (byId.has(node.id)) {
      issues.push({ path: `${path}.id`, message: `duplicate node id "${node.id}"` })
      return
    }
    byId.set(node.id, node)
    if (node.label !== undefined && typeof node.label !== 'string') {
      issues.push({ path: `${path}.label`, message: 'label must be a string' })
    }
  })

  edges.forEach((edge, index) => {
    const path = `$.edges[${index}]`
    if (!isObject(edge)) {
      issues.push({ path, message: 'edge is not an object' })
      return
    }
    for (const end of ['from', 'to'] as const) {
      const value = edge[end]
      if (!isNonEmptyString(value)) {
        issues.push({ path: `${path}.${end}`, message: `edge has no ${end}` })
      } else if (!byId.has(value)) {
        issues.push({ path: `${path}.${end}`, message: `edge points at "${value}", which is not a node in this document` })
      }
    }
    if (edge.label !== undefined && typeof edge.label !== 'string') {
      issues.push({ path: `${path}.label`, message: 'label must be a string' })
    }
  })

  if (isHealthDocument(doc)) validateHealth(doc, byId, issues)
  return issues
}

function validateHealth(
  doc: Record<string, unknown>,
  byId: Map<string, Record<string, unknown>>,
  issues: Issue[],
): void {
  const meta = doc.meta as Record<string, unknown>

  const profile = meta.profile
  if (!isObject(profile)) {
    issues.push({ path: '$.meta.profile', message: 'a health document must carry meta.profile' })
  } else {
    if (!isNonEmptyString(profile.sex)) issues.push({ path: '$.meta.profile.sex', message: 'profile.sex is required' })
    const year = profile.year_of_birth
    if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 2200) {
      issues.push({ path: '$.meta.profile.year_of_birth', message: 'profile.year_of_birth must be an integer year' })
    }
  }

  for (const [id, node] of byId) {
    const path = `$.nodes[${id}]`
    const kind = node.kind
    if (!isNonEmptyString(kind) || !(HEALTH_KINDS as readonly string[]).includes(kind)) {
      issues.push({
        path: `${path}.kind`,
        message: `kind ${JSON.stringify(kind)} is not one of ${HEALTH_KINDS.join(', ')}`,
      })
      continue
    }

    if (typeof node.confirmed !== 'boolean') {
      issues.push({ path: `${path}.confirmed`, message: 'confirmed is required and must be a boolean' })
    }

    if (kind === 'source') {
      if (node.source !== undefined) {
        issues.push({ path: `${path}.source`, message: 'a source node is the provenance, it does not point at one' })
      }
    } else {
      const source = node.source
      if (!isNonEmptyString(source)) {
        issues.push({ path: `${path}.source`, message: 'every fact needs the id of the source it came from' })
      } else {
        const parent = byId.get(source)
        if (!parent) {
          issues.push({ path: `${path}.source`, message: `source "${source}" is not a node in this document` })
        } else if (parent.kind !== 'source') {
          issues.push({ path: `${path}.source`, message: `"${source}" is a ${String(parent.kind)} node, not a source` })
        }
      }
    }

    if ((HEALTH_EVENT_KINDS as readonly string[]).includes(kind)) {
      const when = node.when
      if (when === undefined) {
        issues.push({ path: `${path}.when`, message: `${kind} is an event and needs a date in when` })
      } else if (!isValidWhen(when)) {
        issues.push({ path: `${path}.when`, message: 'when must be an ISO date or an interval {from, to}' })
      }
    }

    if (kind === 'observation') {
      if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
        issues.push({ path: `${path}.value`, message: 'value must be a number, not a string — "4.9 mmol/L" cannot be plotted' })
      }
      if (!isNonEmptyString(node.unit)) {
        issues.push({ path: `${path}.unit`, message: 'unit is required and must be a separate string' })
      }
      for (const bound of ['ref_low', 'ref_high'] as const) {
        if (node[bound] !== undefined && typeof node[bound] !== 'number') {
          issues.push({ path: `${path}.${bound}`, message: `${bound} must be a number` })
        }
      }
      if (node.flag !== undefined && !(OBSERVATION_FLAGS as readonly string[]).includes(String(node.flag))) {
        issues.push({ path: `${path}.flag`, message: `flag must be one of ${OBSERVATION_FLAGS.join(', ')}` })
      }
    }

    if ((kind === 'condition' || kind === 'medication') && !(CONDITION_STATUS as readonly string[]).includes(String(node.status))) {
      issues.push({ path: `${path}.status`, message: `a ${kind} needs status: ${CONDITION_STATUS.join(', ')}` })
    }

    const confidence = node.confidence
    if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
      issues.push({ path: `${path}.confidence`, message: 'confidence is 0..1' })
    }
  }

  const edges = doc.edges as unknown[]
  edges.forEach((edge, index) => {
    if (!isObject(edge)) return
    const path = `$.edges[${index}]`
    const label = edge.label
    const rule = isNonEmptyString(label) ? HEALTH_EDGE_LABELS[label] : undefined
    if (!rule) {
      issues.push({
        path: `${path}.label`,
        message: `relation ${JSON.stringify(label)} is not in the contract: ${Object.keys(HEALTH_EDGE_LABELS).join(', ')}`,
      })
      return
    }
    const from = byId.get(String(edge.from))
    const to = byId.get(String(edge.to))
    if (!from || !to) return // reported by the base pass
    if (!rule.from.includes('*') && !rule.from.includes(String(from.kind))) {
      issues.push({
        path: `${path}.from`,
        message: `${label} starts at ${String(from.kind)}, expected ${rule.from.join(' or ')}`,
      })
    }
    if (!rule.to.includes(String(to.kind))) {
      issues.push({ path: `${path}.to`, message: `${label} ends at ${String(to.kind)}, expected ${rule.to.join(' or ')}` })
    }
  })
}

function isValidWhen(when: unknown): boolean {
  if (typeof when === 'string') return ISO_DATE.test(when)
  if (!isObject(when)) return false
  if (!isNonEmptyString(when.from) || !ISO_DATE.test(when.from)) return false
  if (when.to !== undefined && when.to !== null) {
    return isNonEmptyString(when.to) && ISO_DATE.test(when.to)
  }
  return true
}
