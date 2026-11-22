import { describe, expect, test } from 'bun:test'
import { describeValues, probeExpression } from './capture'

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
