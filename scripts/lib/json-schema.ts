/**
 * A small JSON Schema validator — the subset of draft 2020-12 the `kg/1-health` contract uses,
 * and nothing else.
 *
 * Why not a library: the contract gate has to run in the clean room the e2e harness builds, with
 * no `node_modules`, no registry and no network. `bun scripts/validate-kg-fixtures.ts` is the
 * whole install. So this file reads the schema from disk and enforces the keywords below; when
 * the schema grows a keyword this file does not know, `unsupported` fails the run instead of
 * silently passing a document that the schema forbids.
 *
 * Supported: type · const · enum · required · properties · additionalProperties · items ·
 * minItems · maxItems · minProperties · minLength · maxLength · pattern · format (date) ·
 * minimum · maximum · exclusiveMinimum · exclusiveMaximum · allOf · anyOf · oneOf · not · $ref
 * (local, `#/$defs/…`). Anything else is reported, not ignored.
 *
 * Messages are the app's voice, not the spec's: a person reads them.
 */
export type Issue = { path: string; message: string }

type Schema = Record<string, unknown> | boolean

/** An issue plus what produced it — the extra two fields only matter inside `oneOf`. */
type RawIssue = Issue & { rule?: 'required' | 'additional' | 'not' | 'unsupported'; property?: string }

type Run = { branch: Schema; issues: RawIssue[] }

const KNOWN_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minProperties',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Own keys only: a schema is data, and `toString in {}` is not a property of the document. */
const has = (object: Record<string, unknown>, key: string): boolean => Object.keys(object).includes(key)

/** What a reader needs to know about the value that is there instead of the expected one. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'not a finite number'
  return String(value)
}

function typeLabel(types: unknown[]): string {
  const names = types.map((type) => {
    if (type === 'integer') return 'a whole number'
    if (type === 'number') return 'a number'
    if (type === 'string') return 'a string'
    if (type === 'boolean') return 'true or false'
    if (type === 'array') return 'an array'
    if (type === 'object') return 'an object'
    if (type === 'null') return 'null'
    return String(type)
  })
  return names.length === 1 ? String(names[0]) : names.join(' or ')
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isObject(value)
    case 'null':
      return value === null
    default:
      return false
  }
}

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A calendar date, not just the shape of one: 2026-02-30 is not a date. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function resolveRef(ref: string, root: Schema): Schema | undefined {
  if (!ref.startsWith('#/')) return undefined
  const segments = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = root
  for (const segment of segments) {
    if (!isObject(current) || !has(current, segment)) return undefined
    current = current[segment]
  }
  return current as Schema | undefined
}

/** The property every `oneOf` branch pins with `const`, when there is exactly one. */
function discriminatorKey(branches: Schema[]): string | undefined {
  let shared: string | undefined
  for (const branch of branches) {
    if (!isObject(branch) || !isObject(branch.properties)) return undefined
    const pinned = Object.entries(branch.properties)
      .filter(([, sub]) => isObject(sub) && has(sub, 'const'))
      .map(([key]) => key)
    if (pinned.length !== 1) return undefined
    if (shared !== undefined && shared !== pinned[0]) return undefined
    shared = pinned[0]
  }
  return shared
}

function pinnedValue(branch: Schema, key: string): unknown {
  if (!isObject(branch) || !isObject(branch.properties)) return undefined
  const sub = branch.properties[key]
  return isObject(sub) ? sub.const : undefined
}

/** A branch whose `type` fits the value explains the failure better than one that never could. */
function preferType(value: unknown, runs: Run[]): Run {
  const fitting = runs.filter((run) => {
    if (!isObject(run.branch) || !has(run.branch, 'type')) return false
    const declared = run.branch.type
    const types = Array.isArray(declared) ? declared : [declared]
    return types.some((type) => typeof type === 'string' && matchesType(value, type))
  })
  return fitting.length > 0 ? fitting[0] : runs[0]
}

function pushRequired(issues: RawIssue[], path: string, property: string): void {
  issues.push({
    path: `${path}.${property}`,
    message: `must have required property "${property}"`,
    rule: 'required',
    property,
  })
}

/**
 * `oneOf` with the reader in mind. The happy case is silent. When nothing matches, the branch
 * that pins this value's discriminator — a `kind`, say — is the one that was meant, so its reasons
 * are the reader's; the other six only say "wrong kind". When the discriminator is missing or is
 * no branch's value at all, the property's own `enum`/`const` already said it, and this stays
 * quiet rather than inventing a second opinion.
 */
function reportOneOf(value: unknown, branches: Schema[], path: string, root: Schema, issues: RawIssue[]): void {
  const runs = branches.map((branch) => {
    const collected: RawIssue[] = []
    evaluate(value, branch, path, root, collected)
    return { branch, issues: collected }
  })
  const passing = runs.filter((run) => run.issues.length === 0)
  if (passing.length === 1) return
  if (passing.length > 1) {
    issues.push({ path, message: `matches ${passing.length} alternatives; exactly one is allowed` })
    return
  }

  const key = discriminatorKey(branches)
  let chosen: Run
  if (key !== undefined) {
    if (!isObject(value) || !has(value, key)) return
    const match = runs.find((run) => deepEqual(pinnedValue(run.branch, key), value[key]))
    if (match === undefined) return
    chosen = match
  } else {
    chosen = preferType(value, runs)
  }

  const description =
    isObject(chosen.branch) && typeof chosen.branch.description === 'string' ? chosen.branch.description : undefined
  const missing = chosen.issues.filter((issue) => issue.rule === 'required')
  const rest = chosen.issues.filter((issue) => issue.rule !== 'required')
  if (description !== undefined && missing.length > 0) {
    const names = missing.map((issue) => `"${issue.property}"`).join(', ')
    issues.push({ path, message: `${description} — missing ${names}` })
  } else {
    issues.push(...missing)
  }
  issues.push(...rest)
}

function evaluate(value: unknown, schema: Schema, path: string, root: Schema, issues: RawIssue[]): void {
  if (schema === true) return
  if (schema === false) {
    issues.push({ path, message: 'is not allowed here' })
    return
  }
  if (!isObject(schema)) return

  for (const keyword of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(keyword) && !keyword.startsWith('x-')) {
      issues.push({
        path,
        message: `the schema uses "${keyword}", which this validator does not implement — a keyword nobody enforces is a rule that silently passes`,
        rule: 'unsupported',
      })
    }
  }

  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root)
    if (target === undefined) {
      issues.push({ path, message: `the schema points at ${schema.$ref}, which is not in this file`, rule: 'unsupported' })
    } else {
      evaluate(value, target, path, root, issues)
    }
  }

  if (has(schema, 'type')) {
    const declared = schema.type
    const types = Array.isArray(declared) ? declared : [declared]
    const fits = types.some((type) => typeof type === 'string' && matchesType(value, type))
    if (!fits) {
      issues.push({ path, message: `must be ${typeLabel(types)}, not ${describe(value)}` })
      // Every other keyword here would only restate the same mistake.
      return
    }
  }

  if (has(schema, 'const') && !deepEqual(value, schema.const)) {
    issues.push({ path, message: `must be ${JSON.stringify(schema.const)}, found ${describe(value)}` })
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(value, option))) {
    const options = schema.enum.map((option) => (typeof option === 'string' ? option : JSON.stringify(option)))
    issues.push({ path, message: `must be one of: ${options.join(', ')}` })
  }

  if (typeof value === 'number') {
    const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema
    if (typeof minimum === 'number' && value < minimum) {
      issues.push({ path, message: `must be at least ${minimum}, found ${value}` })
    }
    if (typeof maximum === 'number' && value > maximum) {
      issues.push({ path, message: `must be at most ${maximum}, found ${value}` })
    }
    if (typeof exclusiveMinimum === 'number' && value <= exclusiveMinimum) {
      issues.push({ path, message: `must be greater than ${exclusiveMinimum}, found ${value}` })
    }
    if (typeof exclusiveMaximum === 'number' && value >= exclusiveMaximum) {
      issues.push({ path, message: `must be less than ${exclusiveMaximum}, found ${value}` })
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ path, message: schema.minLength === 1 ? 'must not be empty' : `must be at least ${schema.minLength} characters` })
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ path, message: `must be at most ${schema.maxLength} characters` })
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      issues.push({ path, message: `must match the pattern ${schema.pattern}` })
    }
    if (schema.format === 'date' && !isCalendarDate(value)) {
      issues.push({ path, message: `must be a date, YYYY-MM-DD${value.length < 12 ? `, not ${describe(value)}` : ''}` })
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ path, message: `must hold at least ${schema.minItems} item(s)` })
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ path, message: `must hold at most ${schema.maxItems} item(s)` })
    }
    if (has(schema, 'items')) {
      const items = schema.items as Schema
      value.forEach((item, index) => evaluate(item, items, `${path}[${index}]`, root, issues))
    }
  }

  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {}
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
      issues.push({ path, message: `must hold at least ${schema.minProperties} propert(ies)` })
    }
    if (Array.isArray(schema.required)) {
      for (const property of schema.required) {
        if (typeof property === 'string' && !has(value, property)) pushRequired(issues, path, property)
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (has(value, key)) evaluate(value[key], sub as Schema, `${path}.${key}`, root, issues)
    }
    const extra = Object.keys(value).filter((key) => !has(properties, key))
    if (schema.additionalProperties === false) {
      for (const key of extra) {
        issues.push({ path: `${path}.${key}`, message: 'is not part of the contract', rule: 'additional', property: key })
      }
    } else if (isObject(schema.additionalProperties)) {
      for (const key of extra) evaluate(value[key], schema.additionalProperties, `${path}.${key}`, root, issues)
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) evaluate(value, sub as Schema, path, root, issues)
  }

  if (Array.isArray(schema.anyOf)) {
    const runs = (schema.anyOf as Schema[]).map((branch) => {
      const collected: RawIssue[] = []
      evaluate(value, branch, path, root, collected)
      return { branch, issues: collected }
    })
    if (!runs.some((run) => run.issues.length === 0)) {
      const chosen = preferType(value, runs)
      issues.push(...chosen.issues)
    }
  }

  if (Array.isArray(schema.oneOf)) {
    reportOneOf(value, schema.oneOf as Schema[], path, root, issues)
  }

  if (has(schema, 'not')) {
    const inner: RawIssue[] = []
    evaluate(value, schema.not as Schema, path, root, inner)
    if (inner.length === 0) {
      const notSchema = schema.not
      const message =
        isObject(notSchema) && typeof notSchema.description === 'string'
          ? notSchema.description
          : 'must not match this shape'
      issues.push({ path, message, rule: 'not' })
    }
  }
}

/** Validate one value against one schema. An empty array means it conforms. */
export function validateAgainstSchema(value: unknown, schema: Schema): Issue[] {
  const issues: RawIssue[] = []
  evaluate(value, schema, '$', schema, issues)
  return issues.map(({ path, message }) => ({ path, message }))
}
