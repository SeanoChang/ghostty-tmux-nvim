export type Part = { name: string; tokens: number }

export type Limit = { percent: number; resetsIn: string }

export type CacheView = {
  isWarm: boolean
  leftS: number
  hitPercent: number | null
  misses: number
  rebuildTokens: number
  rebuildUsd: number
  keepalive: { used: number; max: number } | null
}

export type Snapshot = {
  branch: string
  isDirty: boolean
  contextPercent: number
  contextTokens: number
  contextWindow: number
  five: Limit | null
  seven: Limit | null
  costUsd: number | null
  parts: Part[]
  cache: CacheView | null
}

declare module 'claude-code' {
  interface PluginState {
    'statusline-bridge': { snapshot: Snapshot | null }
  }
}
