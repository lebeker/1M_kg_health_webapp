import { describe, expect, test } from 'bun:test'
import { HEALTH_EVENT_KINDS, HEALTH_KINDS, validateKg } from '../scripts/lib/kg-contract'
import {
  EVENT_KINDS,
  EVENT_STATUSES,
  EventModelError,
  eventAnchor,
  createEvent,
  eventsOf,
  isCalendarDate,
  isEventDate,
  isEventKind,
  type NewEvent,
} from './events'

/** The minimum a kind has to say, as the contract states it. */
const minimal: Record<string, NewEvent> = {
  observation: { id: 'obs-1', kind: 'observation', when: '2026-11-12', value: 4.9, unit: 'mmol/L', source: 'doc-1' },
  condition: { id: 'cond-1', kind: 'condition', when: { from: '2021-05-14' }, status: 'active', source: 'doc-1' },
  medication: { id: 'med-1', kind: 'medication', when: '2026-08-19', status: 'active', source: 'doc-1' },
  procedure: { id: 'proc-1', kind: 'procedure', when: '2021-05-15', source: 'doc-1' },
  encounter: { id: 'enc-1', kind: 'encounter', when: '2021-05-14', source: 'doc-1' },
  document: { id: 'doc-1', kind: 'document', when: '2021-05-14', label: 'Discharge note' },
  immunization: { id: 'imm-1', kind: 'immunization', when: '2024-10-15', source: 'doc-1' },
  device: { id: 'dev-1', kind: 'device', when: '2024-10-15', source: 'doc-1' },
  allergy: { id: 'allergy-1', kind: 'allergy', when: '2024-10-15', status: 'active', source: 'doc-1' },
}

const documentOf = (events: NewEvent[]): unknown => ({
  meta: {
    title: 't',
    schema: 'kg/1',
    app: 'health-viewer',
    profile: { sex: 'male', year_of_birth: 1961 },
  },
  nodes: events.map(createEvent),
  edges: [],
})

const rejection = (input: unknown): string => {
  try {
    createEvent(input as NewEvent)
  } catch (error) {
    if (error instanceof EventModelError) return error.message
    throw error
  }
  throw new Error('createEvent accepted an event it should have refused')
}

describe('the event model', () => {
  test('it is the contract\'s event kinds, and they agree', () => {
    expect([...EVENT_KINDS]).toEqual([
      'observation', 'condition', 'medication', 'procedure', 'encounter', 'document',
      'immunization', 'device', 'allergy',
    ])
    expect([...EVENT_KINDS].sort()).toEqual([...HEALTH_EVENT_KINDS].sort())
    for (const kind of EVENT_KINDS) expect(HEALTH_KINDS).toContain(kind)
  })

  test('a summary and a prediction are visible but are not events', () => {
    expect(isEventKind('summary')).toBe(false)
    expect(isEventKind('prediction')).toBe(false)
    expect(isEventKind('symptom')).toBe(false)
    expect(() => createEvent({ id: 'sum-1', kind: 'summary', when: '2026-01-01', source: 'doc-1' } as NewEvent)).toThrow(
      /not an event kind/,
    )
  })

  test('every event kind builds from its smallest valid input and passes the contract gate', () => {
    for (const kind of EVENT_KINDS) {
      const event = createEvent(minimal[kind])
      expect(event.kind).toBe(kind)
      expect(event.confirmed).toBe(false)
    }
    expect(validateKg(documentOf(EVENT_KINDS.map((kind) => minimal[kind])))).toEqual([])
  })
})

describe('no event exists without a date', () => {
  test('every kind refuses a missing date, and says which kind it was', () => {
    for (const kind of EVENT_KINDS) {
      const input = { ...minimal[kind] } as Record<string, unknown>
      delete input.when
      expect(rejection(input)).toContain(`a ${kind} cannot be created without a date`)
    }
  })

  test('an empty, malformed or impossible date is not a date', () => {
    expect(rejection({ ...minimal.encounter, when: '' })).toContain('cannot be created without a date')
    expect(rejection({ ...minimal.encounter, when: '14 May 2021' })).toContain('cannot be created with that date')
    expect(rejection({ ...minimal.encounter, when: '2026-02-30' })).toContain('cannot be created with that date')
    expect(rejection({ ...minimal.encounter, when: 20210514 as unknown as string })).toContain('cannot be created with that date')
  })

  test('an interval needs a start and may not end before it starts', () => {
    expect(rejection({ ...minimal.condition, when: { to: '2021-05-14' } })).toContain('cannot be created with that date')
    expect(rejection({ ...minimal.condition, when: { from: '2021-05-14', to: '2020-01-01' } })).toContain(
      'cannot be created with that date',
    )
    expect(createEvent({ ...minimal.condition, when: { from: '2021-05-14', to: null } }).kind).toBe('condition')
  })

  test('the date helpers agree with the factory', () => {
    expect(isCalendarDate('2026-11-12')).toBe(true)
    expect(isCalendarDate('2026-2-1')).toBe(false)
    expect(isEventDate({ from: '2026-11-12', to: '2026-11-13' })).toBe(true)
    expect(isEventDate({ from: '2026-11-12', to: '2026-11-11' })).toBe(false)
    expect(isEventDate(undefined)).toBe(false)
  })

  test('the gate refuses an event kind with no date, so a model-made event never needs repair at render time', () => {
    const doc = documentOf(EVENT_KINDS.map((kind) => minimal[kind])) as { nodes: Array<Record<string, unknown>> }
    doc.nodes.push({ id: 'enc-2', kind: 'encounter', source: 'doc-1', confirmed: true })
    expect(validateKg(doc).map((issue) => issue.message).join(' | ')).toContain('missing "when"')
  })
})

describe('required fields are the contract’s, not the caller’s', () => {
  test('an observation has a number and a unit', () => {
    expect(rejection({ ...minimal.observation, value: undefined })).toContain('numeric value')
    expect(rejection({ ...minimal.observation, value: '4.9 mmol/L' })).toContain('numeric value')
    expect(rejection({ ...minimal.observation, unit: '' })).toContain('needs its unit')
  })

  test('a condition and a medication have a status from the contract', () => {
    for (const kind of ['condition', 'medication'] as const) {
      const input = { ...minimal[kind] } as Record<string, unknown>
      delete input.status
      expect(rejection(input)).toContain(`a ${kind} needs its status`)
      expect(rejection({ ...minimal[kind], status: 'cured' })).toContain(`a ${kind} needs its status`)
      expect(EVENT_STATUSES).toContain(createEvent(minimal[kind]).status as (typeof EVENT_STATUSES)[number])
    }
  })

  test('a fact points at the document it came from', () => {
    for (const kind of EVENT_KINDS.filter((k) => k !== 'document')) {
      const input = { ...minimal[kind] } as Record<string, unknown>
      delete input.source
      expect(rejection(input)).toContain(`a ${kind} needs the document it came from`)
      expect(rejection({ ...minimal[kind], source: '  ' })).toContain(`a ${kind} needs the document it came from`)
    }
  })

  test('the document is the provenance and points at none', () => {
    expect(rejection({ ...minimal.document, source: 'doc-1' })).toContain('does not point at a source of its own')
    expect(createEvent(minimal.document).source).toBeUndefined()
  })

  test('confirmed defaults to false and is never a maybe', () => {
    expect(createEvent(minimal.encounter).confirmed).toBe(false)
    expect(createEvent({ ...minimal.encounter, confirmed: true }).confirmed).toBe(true)
    expect(rejection({ ...minimal.encounter, confirmed: 'yes' })).toContain('true or false')
  })

  test('a created event is frozen: the timeline reads history, it does not edit it', () => {
    const event = createEvent(minimal.encounter)
    expect(Object.isFrozen(event)).toBe(true)
    const editable = event as Record<string, unknown>
    expect(() => {
      editable.when = '2030-01-01'
    }).toThrow()
  })
})

describe('reading events out of a document', () => {
  const doc = {
    nodes: [
      { id: 'doc-1', kind: 'document', when: '2021-05-14' },
      { id: 'sum-2025', kind: 'summary', when: '2026-01-01', source: 'doc-1' },
      { id: 'cond-1', kind: 'condition', when: { from: '2021-05-14' }, status: 'active', source: 'doc-1' },
      { id: 'pred-1', kind: 'prediction', source: 'doc-1' },
      { id: 'obs-1', kind: 'observation', when: '2026-11-12', value: 4.9, unit: 'mmol/L', source: 'doc-1' },
    ],
  }

  test('only the event kinds come out, in document order', () => {
    expect(eventsOf(doc).map((event) => event.id)).toEqual(['doc-1', 'cond-1', 'obs-1'])
  })

  test('a document with no nodes is an empty timeline, not a crash', () => {
    expect(eventsOf({})).toEqual([])
    expect(eventsOf({ nodes: 'not an array' })).toEqual([])
  })

  test('the anchor of an event is its own date, or the day its interval began', () => {
    expect(eventAnchor({ when: '2026-11-12' })).toBe('2026-11-12')
    expect(eventAnchor({ when: { from: '2021-05-14', to: null } })).toBe('2021-05-14')
    expect(eventAnchor({})).toBeUndefined()
    expect(eventAnchor({ when: '2026-02-30' })).toBeUndefined()
  })
})
