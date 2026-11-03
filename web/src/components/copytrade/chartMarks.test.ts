import { describe, expect, it } from 'vitest'
import type { FeedItem, Holder, SymbolSummary } from '../../lib/api/copyTrade'
import { barFor, buildMarks, positionResult } from './chartMarks'
import { sortCoins } from './CoinsTab'

const hour = 3600
const times = [0, 1, 2, 3, 4].map((i) => 1_000_000 + i * hour)

const ev = (p: Partial<FeedItem>): FeedItem => ({
  time: 0,
  symbol: 'BTCUSDT',
  side: 'long',
  action: 'open',
  qty: 1,
  price: 100,
  value: 100,
  realized_pnl: 0,
  fee: 0,
  position_qty: 1,
  portfolio_id: 'a',
  nickname: 'A',
  avatar_url: '',
  ...p,
})

const holder = (p: Partial<Holder>): Holder => ({
  symbol: 'BTCUSDT',
  side: 'long',
  qty: 1,
  entry_price: 100,
  entry_value: 100,
  opened_at: 0,
  source: 'inferred',
  portfolio_id: 'a',
  nickname: 'A',
  avatar_url: '',
  roi_30d: 0,
  pnl_30d: 0,
  win_rate_30d: 0,
  ...p,
})

describe('chart marks', () => {
  it('snaps a time to the candle containing it', () => {
    expect(barFor(times, (times[2] + 1800) * 1000)).toBe(times[2])
    expect(barFor(times, (times[4] + 3599) * 1000)).toBe(times[4])
    expect(barFor(times, (times[0] - 1) * 1000)).toBeNull()
    expect(barFor(times, (times[4] + hour) * 1000)).toBeNull()
  })

  it('puts entries on candles, exits as arrows, and pins held positions entered before the chart', () => {
    const events = [
      ev({
        time: (times[3] + 10) * 1000,
        action: 'close',
        realized_pnl: 5,
        portfolio_id: 'a',
      }),
      ev({ time: (times[1] + 10) * 1000, action: 'open', portfolio_id: 'a' }),
      ev({ time: (times[0] - hour) * 1000, action: 'open', portfolio_id: 'b' }),
    ]
    const holders = [
      holder({
        portfolio_id: 'b',
        side: 'short',
        entry_price: 120,
        opened_at: (times[0] - hour) * 1000,
      }),
    ]
    const { entries, exits } = buildMarks(events, holders, times)
    expect(entries.map((m) => [m.kind, m.portfolioId, m.bar])).toEqual([
      ['entry', 'a', times[1]],
      ['pinned', 'b', 0],
    ])
    expect(entries[1].price).toBe(120)
    expect(exits).toHaveLength(1)
    expect(exits[0].bar).toBe(times[3])
  })

  it('reports held PnL on margin, or the realized PnL of a closed position', () => {
    const held = {
      key: 'k',
      kind: 'entry' as const,
      portfolioId: 'a',
      side: 'long' as const,
      bar: 0,
      price: 100,
      holder: holder({ margin: 10, unrealized_pnl: 2 }),
    }
    expect(positionResult(held, [], 0)).toMatchObject({
      state: 'held',
      pnl: 2,
      pct: 20,
      pctOfMargin: true,
    })

    const open = ev({ time: 1000 })
    const events = [
      ev({ time: 3000, action: 'close', realized_pnl: 7 }),
      ev({ time: 2000, action: 'reduce', realized_pnl: 3 }),
      open,
    ]
    const closed = {
      key: 'k',
      kind: 'entry' as const,
      portfolioId: 'a',
      side: 'long' as const,
      bar: 0,
      price: 100,
      event: open,
    }
    expect(positionResult(closed, events, 0)).toMatchObject({
      state: 'closed',
      pnl: 10,
    })
  })
})

describe('coin list sorting', () => {
  const coin = (
    symbol: string,
    l: number,
    s: number,
    value = 100,
    confidence = 0
  ): SymbolSummary => ({
    symbol,
    long: { traders: l, value, avg_entry: 0 },
    short: { traders: s, value: 0, avg_entry: 0 },
    confidence: {
      direction: l > s ? 'long' : s > l ? 'short' : 'neutral',
      score: confidence,
      agreement: 0,
      long_share: 0,
      count_factor: 0,
      quality: 0,
      traders: l + s,
    },
  })
  const list = [
    coin('A', 3, 2),
    coin('B', 5, 0),
    coin('C', 0, 2),
    coin('D', 1, 1, 999),
  ]

  it('sorts by traders, one-sidedness and value', () => {
    expect(sortCoins(list, 'traders', 'all').map((c) => c.symbol)).toEqual([
      'A',
      'B',
      'D',
      'C',
    ])
    expect(sortCoins(list, 'consensus', 'all').map((c) => c.symbol)).toEqual([
      'B',
      'C',
      'A',
      'D',
    ])
    expect(sortCoins(list, 'value', 'all')[0].symbol).toBe('D')
  })

  it('sorts by confidence', () => {
    const scored = [
      coin('X', 1, 0, 10, 20),
      coin('Y', 4, 0, 10, 75),
      coin('Z', 2, 1, 10, 40),
    ]
    expect(sortCoins(scored, 'confidence', 'all').map((c) => c.symbol)).toEqual(
      ['Y', 'Z', 'X']
    )
  })

  it('filters by side', () => {
    expect(sortCoins(list, 'traders', 'long').map((c) => c.symbol)).toEqual([
      'A',
      'B',
    ])
    expect(sortCoins(list, 'traders', 'short').map((c) => c.symbol)).toEqual([
      'C',
    ])
  })
})
