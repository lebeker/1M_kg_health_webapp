import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureWithBinary } from './capture'
import { receiptPages } from './ci-gate'
import { checksPass, gateFor, readRun, REQUIRED_CHECKS } from './gate'
import { hostAppHit } from './policy'
import { type Check, describeGaps, evidenceGaps, hardFailures, receiptDescription, screenshotCheck, verdict } from './receipt'

const SHA = 'a'.repeat(40)
const packaged = '/Users/someone/.hermes/tools/agent-browser-0.26.0-darwin-arm64/bin/agent-browser-darwin-arm64'

function check(over: Partial<Check> = {}): Check {
  return { name: 'case.dom', ok: true, detail: 'ok', ...over }
}

/** The two checks a capture that never got a photograph produces: the page read, the picture not. */
function captureChecks(shot: Partial<Check> = {}): Check[] {
  return [
    check({ name: 'case.browser', ok: true, detail: 'the page was opened and read (not photographed)' }),
    check({ name: 'case.url', ok: true, detail: 'ok' }),
    check({ name: 'case.dom', ok: true, detail: 'ok' }),
    check(shot),
    check({ name: 'capture.browser-only', ok: true, detail: '4 capture calls' }),
    check({ name: 'policy.no-host-apps', ok: true, detail: 'ok' }),
    check({ name: 'policy.stays-in-room', ok: true, detail: 'ok' }),
  ]
}

describe('a broken camera is a gap on the receipt, not a red run', () => {
  test('the screenshot check is not a product assertion', () => {
    const shot = screenshotCheck('case', { screenshot: '', screenshotBytes: 0, screenshotRoute: 'agent-browser' })
    expect(shot.ok).toBe(false)
    expect(shot.hard).toBe(false)
    expect(shot.detail).toContain('evidence gap')
  })

  test('a page whose only ungreen check is the picture still passes', () => {
    const checks = captureChecks(screenshotCheck('case', { screenshot: '', screenshotBytes: 0, screenshotRoute: '' }))
    const result = verdict(checks)
    expect(result.failures).toHaveLength(0)
    expect(result.gaps).toHaveLength(1)
    expect(result.passed).toBe(true)
    expect(gatePasses(checks)).toBe(true)
  })

  test('a page that was never read is still a hard failure', () => {
    const checks = captureChecks(screenshotCheck('case', { screenshot: '', screenshotBytes: 0, screenshotRoute: '' }))
    checks[2] = check({ name: 'case.dom', ok: false, detail: '0 bytes of DOM' })
    const result = verdict(checks)
    expect(result.failures.map((failure) => failure.name)).toEqual(['case.dom'])
    expect(result.passed).toBe(false)
    expect(gatePasses(checks)).toBe(false)
  })

  test('a check with no lane is hard: the old default does not become a gap', () => {
    expect(hardFailures([check({ ok: false })]).map((failure) => failure.name)).toEqual(['case.dom'])
    expect(evidenceGaps([check({ ok: false })])).toHaveLength(0)
  })

  test('the two lanes are printed as different words', () => {
    const checks = [check({ ok: false, hard: false, name: 'case.screenshot', detail: 'no screenshot' })]
    expect(describeGaps(checks)).toEqual(['case.screenshot: no screenshot'])
  })
})

describe('the receipt says what it could not photograph', () => {
  const gap = screenshotCheck('case', { screenshot: '', screenshotBytes: 0, screenshotRoute: '' })

  test('a green receipt names the page marker CI reads and counts the gaps', () => {
    const description = receiptDescription({ pages: ['case'], failures: [], gaps: [gap], run: 't_x-2026-11-23', cardId: 't_3228263b' })
    expect(description).toContain('G3 [case] PASS')
    expect(description).toContain('1 evidence gap')
    expect(description).not.toContain('failed')
    // The marker is what `ci-gate.ts` matches on; a receipt whose marker moved is a receipt the
    // gate cannot read, whatever it says afterwards.
    expect(receiptPages(description)).toEqual(['case'])
  })

  test('both pages stay readable as a marker', () => {
    const description = receiptDescription({ pages: ['case', 'graph'], failures: [], gaps: [], run: 'run', cardId: 't_x' })
    expect(description).toContain('G3 [case+graph] PASS')
    expect(description).not.toContain('evidence gap')
    expect(receiptPages(description)).toEqual(['case', 'graph'])
  })

  test('a profile-view receipt says so beside the page marker CI reads', () => {
    const description = receiptDescription({ pages: ['case'], view: 'profile', failures: [], gaps: [], run: 'run', cardId: 't_x' })
    expect(description).toContain('G3 [case] PASS (profile view)')
    // the marker itself is unchanged: a status whose `[case]` moved is one `ci-gate.ts` cannot read
    expect(receiptPages(description)).toEqual(['case'])
    // a record-column run is not dressed as a view run
    expect(receiptDescription({ pages: ['case'], view: 'record', failures: [], gaps: [], run: 'run', cardId: 't_x' })).not.toContain('profile view')
  })

  test('a red receipt names the product checks, not the camera', () => {
    const description = receiptDescription({
      pages: ['graph'],
      failures: [check({ name: 'graph.claim', ok: false, detail: 'not visible: "HbA1c"' }), check({ name: 'g2.verify', ok: false, detail: 'tsc' })],
      gaps: [gap],
      run: 'run',
      cardId: 't_x',
    })
    expect(description).toContain('2 failed: graph.claim, g2.verify')
    expect(description).not.toContain('evidence gap')
  })
})

describe('the gate reads a gap the same way the run wrote it', () => {
  function runDir(checks: Check[], passed = true): string {
    const out = mkdtempSync(join(tmpdir(), 'e2e-receipt-test-'))
    mkdirSync(join(out, 'run'), { recursive: true })
    writeFileSync(
      join(out, 'run', 'report.json'),
      `${JSON.stringify(
        {
          card: { id: 't_x', page: ['case'] },
          commit: SHA,
          dirty: false,
          pages: [{ label: 'case', kind: 'case' }],
          checks,
          passed,
          finished_at: '2026-11-23T00:40:00.000Z',
        },
        null,
        2,
      )}\n`,
    )
    return out
  }

  test('a report with a red gap and green product checks passes the gate', () => {
    const checks = captureChecks(screenshotCheck('case', { screenshot: '', screenshotBytes: 0, screenshotRoute: '' }))
    const out = runDir(checks)
    expect(readRun(join(out, 'run'))?.passed).toBe(true)
    expect(gateFor(SHA, out).ok).toBe(true)
  })

  test('a report that claims passed with a red gap is still a pass — that is the point', () => {
    const checks = captureChecks(screenshotCheck('case', { screenshot: '', screenshotBytes: 0, screenshotRoute: '' }))
    expect(checksPass(checks)).toBe(true)
  })

  test('a red product check still stops the gate', () => {
    const checks = captureChecks(screenshotCheck('case', { screenshot: '', screenshotBytes: 0, screenshotRoute: '' }))
    checks.push(check({ name: 'case.claim', ok: false, detail: 'not visible: "LDL"' }))
    const out = runDir(checks)
    const result = gateFor(SHA, out)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('case.claim')
    expect(result.reason).toContain('evidence gap')
  })
})

describe('the capture refused before it spawns anything', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'e2e-capture-refusal-')), 'shot.png')

  test('a desktop application is not a capture device', () => {
    const result = captureWithBinary({
      url: 'file:///tmp/page.html',
      out,
      binary: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      session: 't',
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('desktop application')
  })

  test('the harness own binary is not a desktop application', () => {
    expect(hostAppHit(packaged)).toBeNull()
    expect(hostAppHit('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).not.toBeNull()
    expect(hostAppHit('/usr/bin/osascript')).not.toBeNull()
    expect(hostAppHit('chrome --remote-debugging-port=9222')).not.toBeNull()
  })

  test('a relative output path is refused: the browser daemon resolves it elsewhere', () => {
    const result = captureWithBinary({ url: 'file:///tmp/page.html', out: 'shot.png', binary: process.execPath, session: 't' })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('relative screenshot path')
  })

  test('a missing binary is a gap the receipt can name', () => {
    const result = captureWithBinary({ url: 'file:///tmp/page.html', out, binary: '/nowhere/agent-browser', session: 't' })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no bundled agent-browser binary')
  })

  test('the deliberate break is the break, not a browser', () => {
    const previous = process.env.E2E_CAPTURE_PROBE
    process.env.E2E_CAPTURE_PROBE = 'broken'
    try {
      // An otherwise valid route: existing binary, absolute output. The probe is the last refusal,
      // so it is the one that fires — and a broken probe must not be mistaken for a missing binary
      // or a host application when `bun run verify` inherits the variable from an e2e run.
      const result = captureWithBinary({ url: 'file:///tmp/page.html', out, binary: process.execPath, session: 't' })
      expect(result.ok).toBe(false)
      expect(result.detail).toContain('deliberately broken')
    } finally {
      if (previous === undefined) delete process.env.E2E_CAPTURE_PROBE
      else process.env.E2E_CAPTURE_PROBE = previous
    }
  })
})

/** The gate's reading of a check list, without a run directory: the same rule `readRun` applies. */
function gatePasses(checks: Check[]): boolean {
  const required = REQUIRED_CHECKS.map((name) => checks.find((entry) => entry.name === name)).filter((entry): entry is Check => Boolean(entry))
  return required.length === REQUIRED_CHECKS.length && checksPass(checks)
}
