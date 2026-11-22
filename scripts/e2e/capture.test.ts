import { describe, expect, test } from 'bun:test'
import { describeValues } from './capture'

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
})
