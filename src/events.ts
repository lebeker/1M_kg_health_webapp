/**
 * The event model: everything the viewer draws as having happened is an event with a date and a
 * source. Six kinds — condition, observation, medication, procedure, encounter, document — and this
 * module is where the template builds one and where it refuses the mistakes that make a timeline
 * lie: an event with no date, and a fact with no document behind it.
 *
 * A `document` is an event in its own right: it has the date printed on it and it sits on the
 * timeline with the facts it carries, but it is the provenance, so it is the one event that points
 * at no `source` of its own. A `summary` (a virtual marker) and a `prediction` (a simulation) are
 * visible and are not events; they are not in this model.
 *
 * The contract is `docs/DATA-CONTRACT.md` §Node kinds and `scripts/schema/kg-1-health.schema.json`.
 * `src/events.test.ts` holds this list against the schema, so the model cannot drift from the gate.
 */

export const EVENT_KINDS = ['observation', 'condition', 'medication', 'procedure', 'encounter', 'document'] as const

export type EventKind = (typeof EVENT_KINDS)[number]

/** The status a condition or a medication can carry; a procedure and an encounter are done, not active. */
export const EVENT_STATUSES = ['active', 'resolved', 'suspected', 'stopped'] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

/** A point in time, or the interval something lasted (`to: null` still lasts). */
export type EventDate = string | { from: string; to?: string | null }

/**
 * One event in the record. The fields a kind requires are listed in `REQUIRED_FIELDS`; anything
 * else the document carries is kept untouched, because the renderer's contract is that an extra
 * key is a property, never a mistake.
 */
export type HealthEvent = {
  id: string
  kind: EventKind
  when: EventDate
  confirmed: boolean
  label?: string
  source?: string
  status?: EventStatus
  code?: string
  value?: number
  unit?: string
  ref_low?: number
  ref_high?: number
  flag?: 'low' | 'normal' | 'high' | 'critical'
  link?: string
  confidence?: number
  [key: string]: unknown
}

/** What a caller has to supply: `confirmed` is the only field the model fills in, and it fills in `false`. */
export type NewEvent = {
  id: string
  kind: EventKind
  when: EventDate
  confirmed?: boolean
  [key: string]: unknown
}

/**
 * The required fields per kind, after `id` and the date that every event has. `source` is absent
 * from the document's row on purpose: the document is the source. `confirmed` is absent because the
 * factory supplies it — an event nobody confirmed is `false`, never silent.
 */
export const REQUIRED_FIELDS: Record<EventKind, readonly string[]> = {
  observation: ['id', 'when', 'value', 'unit', 'source'],
  condition: ['id', 'when', 'status', 'source'],
  medication: ['id', 'when', 'status', 'source'],
  procedure: ['id', 'when', 'source'],
  encounter: ['id', 'when', 'source'],
  document: ['id', 'when'],
}

/** The model's own refusal. Thrown by `createEvent`, never by reading a document. */
export class EventModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EventModelError'
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A calendar date, not just the shape of one: 2026-02-30 is not a date. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** A point date, or an interval that starts on a real date and does not end before it starts. */
export function isEventDate(value: unknown): value is EventDate {
  if (isCalendarDate(value)) return true
  if (!isObject(value)) return false
  if (!isCalendarDate(value.from)) return false
  const to = value.to
  if (to === undefined || to === null) return true
  return isCalendarDate(to) && to >= value.from
}

export const isEventKind = (value: unknown): value is EventKind =>
  typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value)

/**
 * Build one event. It throws rather than returns a half-written node: an event with no date is not
 * an event that can be repaired at render time — nothing can place it on the timeline.
 */
export function createEvent(input: NewEvent): HealthEvent {
  const kind = isObject(input) ? input.kind : undefined
  if (!isEventKind(kind)) {
    throw new EventModelError(
      `"${String(kind)}" is not an event kind: the model has six — ${EVENT_KINDS.join(', ')}`,
    )
  }

  if (!isNonEmptyString(input.id)) throw new EventModelError(`a ${kind} cannot be created without an id`)

  if (input.when === undefined || input.when === null || input.when === '') {
    throw new EventModelError(`a ${kind} cannot be created without a date: set \`when\``)
  }
  if (!isEventDate(input.when)) {
    throw new EventModelError(
      `a ${kind} cannot be created with that date: \`when\` is a calendar date YYYY-MM-DD or an interval { from, to } that starts on one`,
    )
  }

  if (kind === 'document') {
    if (input.source !== undefined && input.source !== null) {
      throw new EventModelError(
        'a document is the provenance, so it does not point at a source of its own — the facts point at the document',
      )
    }
  } else if (!isNonEmptyString(input.source)) {
    throw new EventModelError(`a ${kind} needs the document it came from: set \`source\` to a document id`)
  }

  if (kind === 'observation') {
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
      throw new EventModelError('an observation needs a numeric value: "4.9 mmol/L" cannot be plotted, sorted or compared')
    }
    if (!isNonEmptyString(input.unit)) throw new EventModelError('an observation needs its unit: set `unit` (UCUM where one exists)')
  }

  if (kind === 'condition' || kind === 'medication') {
    const status = input.status
    if (typeof status !== 'string' || !(EVENT_STATUSES as readonly string[]).includes(status)) {
      throw new EventModelError(`a ${kind} needs its status: one of ${EVENT_STATUSES.join(', ')}`)
    }
  }

  if (input.confirmed !== undefined && typeof input.confirmed !== 'boolean') {
    throw new EventModelError('`confirmed` is true or false: a fact whose confirmation is unknown is `false`')
  }

  return Object.freeze({ ...input, confirmed: input.confirmed ?? false }) as HealthEvent
}

/** The date an event sits at: its own date, or the day the interval started. Undefined when unreadable. */
export function eventAnchor(event: { when?: unknown }): string | undefined {
  const when = isObject(event) ? event.when : undefined
  if (isCalendarDate(when)) return when
  if (isObject(when) && isCalendarDate(when.from)) return when.from
  return undefined
}

/**
 * The events in a document, in document order. The gate has already refused a document whose event
 * has no date, so this reads rather than re-validates: it is the model's promise, not a second
 * checker. A `summary`, a `prediction` and any kind the model does not know are not events.
 */
export function eventsOf(document: { nodes?: unknown }): HealthEvent[] {
  const nodes = isObject(document) && Array.isArray(document.nodes) ? document.nodes : []
  return nodes.filter((node): node is HealthEvent => isObject(node) && isEventKind(node.kind)) as HealthEvent[]
}
