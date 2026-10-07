import { describe, expect, test } from 'claude-code/testing'

import { group, keyFor } from '../hooks/register'

describe('context-feed', () => {
  test('maps /context labels to the status line keys', async () => {
    expect(keyFor('System prompt')).toBe('system')
    expect(keyFor('System tools')).toBe('tools')
    expect(keyFor('MCP tools')).toBe('mcp')
    expect(keyFor('Custom agents')).toBe('agents')
    expect(keyFor('Memory files')).toBe('memory')
    expect(keyFor('Skills')).toBe('skills')
    expect(keyFor('Messages')).toBe('messages')
    expect(keyFor('Slash commands')).toBe('other')
  })

  test('sums per key in a fixed order and drops empty rows', async () => {
    const out = group([
      { name: 'Messages', tokens: 200 },
      { name: 'System tools', tokens: 30 },
      { name: 'MCP tools', tokens: 0 },
      { name: 'System prompt', tokens: 10 },
      { name: 'Deferred tools', tokens: 5 },
    ])
    expect(out).toEqual([
      { name: 'system', tokens: 10 },
      { name: 'tools', tokens: 35 },
      { name: 'messages', tokens: 200 },
    ])
  })
})
