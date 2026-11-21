import { describe, expect, test } from 'bun:test'
import { branchNameFor, checkBranchName, parseBranchName } from './lib/branch-name'

describe('the branch naming rule', () => {
  const accepted = [
    'feat/SCRUM-15',
    'feat/SCRUM-15_schema-validator',
    'fix/SCRUM-12_panel-camera',
    'chore/SCRUM-40_delivery-workflow',
    'fix/PROJ2-7',
    'main',
  ]
  for (const branch of accepted) {
    test(`accepts ${branch}`, () => {
      expect(checkBranchName(branch).ok).toBe(true)
    })
  }

  const rejected: Array<[string, string]> = [
    ['feat/scrum-15', 'not upper case'],
    ['feat/SCRUM-15schema', 'missing "_"'],
    ['feat/SCRUM-15_', 'followed by nothing'],
    ['feat/SCRUM-15_Bad-Desc', 'lower-case words'],
    ['feat/SCRUM-15_two_words', 'lower-case words'],
    ['lead/delivery-loop', 'not one of fix, feat, chore'],
    ['SCRUM-15', 'no type prefix'],
    ['feat/15', 'not a Jira ticket'],
    ['feat/', 'nothing after'],
    ['', 'empty'],
  ]
  for (const [branch, expected] of rejected) {
    test(`rejects ${JSON.stringify(branch)} and says why`, () => {
      const result = checkBranchName(branch)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toContain(expected)
    })
  }
})

describe('parsing', () => {
  test('a name without a description parses to the ticket alone', () => {
    expect(parseBranchName('feat/SCRUM-15')).toEqual({ type: 'feat', ticket: 'SCRUM-15', description: null })
  })

  test('a description is kept as written', () => {
    expect(parseBranchName('chore/SCRUM-40_delivery-workflow')).toEqual({
      type: 'chore',
      ticket: 'SCRUM-40',
      description: 'delivery-workflow',
    })
  })

  test('the default branch is exempt, not illegal', () => {
    const result = checkBranchName('main')
    expect(result.ok && result.exempt).toBe(true)
  })
})

describe('deriving a name from a card', () => {
  test('a card with a title gets a clean description', () => {
    expect(branchNameFor('feat', 'SCRUM-15', 'Schema: validator + 6 fixtures!')).toBe(
      'feat/SCRUM-15_schema-validator-6-fixtures',
    )
  })

  test('no description, no trailing underscore', () => {
    expect(branchNameFor('chore', 'scrum-40')).toBe('chore/SCRUM-40')
  })

  test('what it derives always passes the rule', () => {
    const branch = branchNameFor('fix', 'SCRUM-12', '  a very long description that keeps going and going past the limit  ')
    expect(checkBranchName(branch).ok).toBe(true)
  })
})
