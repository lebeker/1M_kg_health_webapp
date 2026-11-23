import { describe, expect, test } from 'bun:test'
import { describeValues, probeExpression, viewCheck } from './capture'

/**
 * The line the harness prints at the end of a passing run. It is the only place a worker reads
 * "what the page was", so a figure the page does not have reads as a broken render: the columns
 * page mounts nothing into `#root`, and printing `values.mounted` for it said `0 elements` on a
 * run that had just passed 20/20.
 */
describe('the summary line uses the figure the page actually has', () => {
  test('a graph capture counts the elements under #root', () => {
    const line = describeValues({ url: 'file:///dist/graph.html', title: 'Health', mounted: 108 })
    expect(line).toBe('file:///dist/graph.html ("Health", 108 elements)')
  })

  test('a columns capture prints its record list and column widths, never "0 elements"', () => {
    const line = describeValues(
      {
        url: 'file:///dist/case.html',
        title: 'Body — layers, sex, views',
        documentState: 'present',
        records: { total: 47, stored: 12 },
        columns: { left: 240, centre: 720, panel: 320 },
      },
      'case',
    )
    expect(line).toBe('file:///dist/case.html ("Body — layers, sex, views", 12 record(s), columns 240/720/320 px)')
    expect(line).not.toContain('0 elements')
    expect(line).not.toContain('elements')
  })

  test('a columns capture with nothing read still says which figure is empty', () => {
    expect(describeValues({}, 'case')).toBe('no url ("", 0 record(s), columns 0/0/0 px)')
  })

  test('a capture that answered from the profile view says so in the line', () => {
    const line = describeValues(
      {
        url: 'file:///dist/case.html',
        title: 'Body — layers, sex, views',
        records: { stored: 12 },
        columns: { left: 240, centre: 720, panel: 320 },
        profileOpen: true,
      },
      'case',
    )
    expect(line).toBe('file:///dist/case.html ("Body — layers, sex, views", 12 record(s), columns 240/720/320 px, profile view)')
  })
})

/**
 * The profile view is a view behind a button, so its text is not in the page until it is opened.
 * The probe opens it through the page's own hook before it reads anything, which is the difference
 * between "the claim was visible" and "the claim was visible to whoever had already clicked".
 */
describe('the columns probe reads the view it was asked about', () => {
  const recordProbe = probeExpression(['family history'], 'case')
  const profileProbe = probeExpression(['family history'], 'case', 'profile')

  test('the profile view is opened only when the card asked for it', () => {
    expect(profileProbe).toContain('const wanted = "profile"')
    expect(profileProbe).toContain('setTimeout(resolve, 300)')
    // a record-column card must not have its claim read from a view nobody opened
    expect(recordProbe).toContain('const wanted = "record"')
    expect(recordProbe).not.toContain('const wanted = "profile"')
  })

  test('the profile view is opened before the text the claim is matched against is read', () => {
    const opened = profileProbe.indexOf('window.__openProfile()')
    const read = profileProbe.indexOf('document.body.innerText')
    expect(opened).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(opened)
  })

  test('and the capture reports which view answered', () => {
    expect(profileProbe).toContain('profileOpen: profileOpen')
    expect(recordProbe).toContain('profileOpen: profileOpen')
  })

  test('the graph probe is untouched: it has no profile view to open', () => {
    expect(probeExpression(['nodes'], 'graph', 'profile')).not.toContain('__openProfile')
  })
})

/**
 * The reviewer's reproduction, run for real (`t_1e5ae777`, review round 1): with the page's
 * `__openProfile` hook removed, three of the card's own five needles — `family history`,
 * `loneliness`, `Lee` — are still in the page's text, because the profile view's copy also exists
 * in the record column and the docs panel. So `expect` matching alone can be green for a view
 * that never opened, and the run has to go red on the view itself.
 *
 * The probe is a string, so these tests execute it: a stub page, the real expression, the real
 * answer. `viewCheck` reads that answer. Between them the chain is fenced end to end — if the
 * probe stops reporting which view it read, or the check stops requiring it, one of these fails.
 */
type StubWindow = {
  __documentState: () => string
  __columns: () => Record<string, unknown>
  __openProfile?: () => unknown
}

const STUB_COLUMNS = {
  left: { width: 240 },
  centre: { width: 720 },
  panel: { width: 320 },
  centreFilled: true,
  centreRecord: 'record-today',
  states: 2,
}

const STUB_PAGE = {
  document: { title: 'Body — layers, sex, views', documentElement: { outerHTML: '<html><body>page</body></html>' }, body: { innerText: 'family history is in the record column' } },
  location: { href: 'file:///evidence/case.html' },
}

/** Run the columns probe against a stub page: the real expression, the real globals it asks for. */
async function probeWith(hooks: Partial<StubWindow>): Promise<Record<string, unknown>> {
  const expression = probeExpression(['family history'], 'case', 'profile')
  const run = new Function('window', 'document', 'location', 'setTimeout', 'crypto', 'TextEncoder', `return ${expression}`) as (
    ...args: unknown[]
  ) => Promise<Record<string, unknown>>
  return run(
    { __documentState: () => 'present', __columns: () => STUB_COLUMNS, ...hooks },
    STUB_PAGE.document,
    STUB_PAGE.location,
    setTimeout,
    crypto,
    TextEncoder,
  )
}

describe('a profile claim is only evidence when the view actually opened', () => {
  test('a page with no hook answers from the record column, and the check is red', async () => {
    const values = await probeWith({})
    expect(values.profileOpen).toBe(false)
    expect(values.view).toBe('record')
    expect(values.viewWanted).toBe('profile')
    expect(String(values.viewDetail)).toContain('no __openProfile hook')
    // The claim itself still "found" its needle — that is the loophole, and it is not the check.
    expect((values.claim as Array<{ found: boolean }>)[0].found).toBe(true)
    const check = viewCheck('case', 'profile', values)
    expect(check.name).toBe('case.view')
    expect(check.ok).toBe(false)
    expect(check.hard).not.toBe(false)
    expect(check.detail).toContain('record column')
  })

  test('a hook that does not open the view is red too', async () => {
    const values = await probeWith({ __openProfile: () => false })
    expect(values.view).toBe('record')
    expect(String(values.viewDetail)).toContain('did not report the view as open')
    expect(viewCheck('case', 'profile', values).ok).toBe(false)
  })

  test('a hook that opens the view answers from it, and the check is green', async () => {
    const values = await probeWith({ __openProfile: () => true })
    expect(values.profileOpen).toBe(true)
    expect(values.view).toBe('profile')
    expect(String(values.viewDetail)).toContain('__openProfile()')
    const check = viewCheck('case', 'profile', values)
    expect(check.ok).toBe(true)
    expect(check.detail).toContain('profile view')
  })

  test('a capture that never ran the probe cannot pass a profile claim', () => {
    expect(viewCheck('case', 'profile', {}).ok).toBe(false)
    // and one whose probe was built for the record column is not a profile capture either
    expect(viewCheck('case', 'profile', { profileOpen: true, view: 'profile', viewWanted: 'record' }).ok).toBe(false)
  })

  test('a record-column card is untouched: the column it boots into is the view it claims', () => {
    expect(viewCheck('case', 'record', {}).ok).toBe(true)
  })

  test('a record probe never opens the profile view, even when the page has a hook', async () => {
    const hooks = { __documentState: () => 'present', __columns: () => STUB_COLUMNS, __openProfile: () => true }
    const expression = probeExpression(['family history'], 'case')
    const run = new Function('window', 'document', 'location', 'setTimeout', 'crypto', 'TextEncoder', `return ${expression}`) as (
      ...args: unknown[]
    ) => Promise<Record<string, unknown>>
    const values = await run(hooks, STUB_PAGE.document, STUB_PAGE.location, setTimeout, crypto, TextEncoder)
    expect(values.profileOpen).toBe(false)
    expect(values.viewWanted).toBe('record')
  })
})
