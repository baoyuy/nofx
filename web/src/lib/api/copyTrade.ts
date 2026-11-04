import { API_BASE, httpClient } from './helpers'

// Copy-trade monitor: Binance futures lead traders the user follows, read
// from binance.com's copy-trading pages by the backend.

export type TradeSide = 'long' | 'short'
export type TradeAction = 'open' | 'add' | 'reduce' | 'close'

export interface CopyTradeStatus {
  client: {
    paused: boolean
    paused_until?: string
    last_error?: string
    last_limited_at?: string
    last_ok_at?: string
    requests_per_min: number
    /** Masked proxy; empty = server IP. */
    proxy: string
  }
  follows: number
  max_follows: number
  hot: number
  failing: number
  oldest_update?: string
}

export interface Leader {
  leadPortfolioId: string
  nickname: string
  avatarUrl: string
  roi: number
  pnl: number
  mdd: number
  winRate: number
  sharpRatio: number
  aum: number
  copierPnl: number
  currentCopyCount: number
  maxCopyCount: number
  apiKeyTag: string
  tradFiTag: string
  startTime: number
  chartItems: { value: number; dateTime: number }[] | null
}

export interface LeaderPage {
  total: number
  list: Leader[]
}

export interface FollowedTrader {
  portfolio_id: string
  nickname: string
  avatar_url: string
  status: string
  position_show: boolean
  aum: number
  copy_count: number
  max_copy_count: number
  roi: number
  pnl: number
  mdd: number
  win_rate: number
  last_trade_time: number
  /** private portfolio: Binance hides its trades, so no data ever shows */
  private?: boolean
  /** the same trader's public portfolio, when private */
  public_id?: string
  followed_at: string
}

export interface TraderPosition {
  symbol: string
  side: TradeSide
  qty: number
  entry_price: number
  /** qty × entry price */
  entry_value: number
  /** ms; 0 = opened before monitoring started */
  opened_at: number
  /** ms of the latest open or add; 0 = not seen */
  last_add_at: number
  source: 'public' | 'inferred'
  /** Binance's for public positions, from the latest mark price otherwise */
  mark_price?: number
  leverage?: number
  margin?: number
  unrealized_pnl?: number
  /** unrealized result in %, of margin when pct_of_margin, else of entry */
  return_pct: number
  pct_of_margin: boolean
  /** a mark price was available */
  priced: boolean
  /** losing 50%+ of margin (5%+ of price when leverage is unknown) */
  trapped: boolean
  /** inferred position whose loss reached the trader's balance */
  liquidated: boolean
  /** opened or added to within 24 hours */
  fresh: boolean
}

export interface TradeEvent {
  time: number
  symbol: string
  side: TradeSide
  action: TradeAction
  qty: number
  price: number
  value: number
  realized_pnl: number
  fee: number
  position_qty: number
  untracked?: boolean
}

export interface TraderSnapshot {
  trader: FollowedTrader
  positions: TraderPosition[] | null
  events: TradeEvent[] | null
  positions_source: 'public' | 'inferred'
  updated_at: string
  error?: string
  hot: boolean
  score: TraderScore
}

export interface FeedItem extends TradeEvent {
  portfolio_id: string
  nickname: string
  avatar_url: string
}

/** A trader's identity and 30-day results. */
export interface TraderBrief {
  nickname: string
  avatar_url: string
  roi_30d: number
  pnl_30d: number
  win_rate_30d: number
  score: number
}

export interface SideSummary {
  traders: number
  value: number
  avg_entry: number
  /** holders deep in loss, among traders */
  trapped: number
  /** holders who opened or added within 24 hours, among traders */
  fresh: number
}

/** A coin's direction among followed traders. */
export interface Confidence {
  direction: TradeSide | 'neutral'
  /** 0-100 */
  score: number
  /** |long − short| / total weight */
  agreement: number
  long_share: number
  /** penalty for few traders, 0-1 */
  count_factor: number
  /** mean trader score of the holders, 0-1 */
  quality: number
  /** leading side's health, 0-1; below 1 when it sits on losses */
  health: number
  traders: number
}

/** How far a lead trader's record can be trusted, 0-100, and its parts (0-1). */
export interface TraderScore {
  score: number
  quality: number
  drawdown: number
  win_rate: number
  tenure: number
  scale: number
  reliability: number
}

export interface HitRate {
  band: 'high' | 'mid' | 'low' | 'all'
  horizon: '4h' | '24h'
  samples: number
  hits: number
  rate: number
  avg_return: number
}

export interface SymbolSummary {
  symbol: string
  long: SideSummary
  short: SideSummary
  confidence: Confidence
  /** traders likely liquidated here; not in long, short or confidence */
  liquidated: number
}

export interface Holder extends TraderPosition, TraderBrief {
  portfolio_id: string
}

export interface FeedQuery {
  portfolio_id?: string
  symbol?: string
  action?: TradeAction | ''
  min_value?: number
  page?: number
  page_size?: number
}

function unwrap<T>(
  result: { success: boolean; data?: T; message?: string },
  fallback: string
): T {
  if (!result.success || result.data === undefined) {
    throw new Error(result.message || fallback)
  }
  return result.data
}

const get = async <T>(path: string, params?: Record<string, unknown>) =>
  unwrap(
    await httpClient.request<T>(`${API_BASE}${path}`, {
      params,
      silent: true,
      timeout: 60000,
    }),
    'Request failed'
  )

export const copyTradeApi = {
  getCopyTradeStatus: () => get<CopyTradeStatus>('/copytrade/status'),

  getLeaderboard: (timeRange: string, sort: string, page: number) =>
    get<LeaderPage>('/copytrade/leaderboard', {
      time_range: timeRange,
      sort,
      page,
    }),

  getFollows: () =>
    get<{ follows: TraderSnapshot[]; max_follows: number }>(
      '/copytrade/follows'
    ),

  getFollow: (id: string) =>
    get<TraderSnapshot>(`/copytrade/follows/${encodeURIComponent(id)}`),

  async follow(id: string): Promise<FollowedTrader> {
    const r = await httpClient.request<FollowedTrader>(
      `${API_BASE}/copytrade/follows`,
      { method: 'POST', data: { id }, silent: true, timeout: 70000 }
    )
    return unwrap(r, 'Follow failed')
  },

  async unfollow(id: string): Promise<void> {
    const r = await httpClient.request<{ ok: boolean }>(
      `${API_BASE}/copytrade/follows/${encodeURIComponent(id)}`,
      { method: 'DELETE', silent: true }
    )
    unwrap(r, 'Unfollow failed')
  },

  getFeed: (q: FeedQuery) =>
    get<{ items: FeedItem[]; total: number; page: number; page_size: number }>(
      '/copytrade/feed',
      {
        ...q,
        action: q.action || undefined,
      }
    ),

  getCopyTradeSymbols: () =>
    get<{ symbols: SymbolSummary[] }>('/copytrade/symbols'),

  getCopyTradeSymbol: (symbol: string) =>
    get<{
      symbol: string
      summary: SymbolSummary | null
      holders: Holder[] | null
      events: FeedItem[] | null
      traders: Record<string, TraderBrief>
    }>(`/copytrade/symbols/${encodeURIComponent(symbol)}`),

  getHitRate: (days = 30) =>
    get<{ days: number; rows: HitRate[] }>('/copytrade/hit-rate', { days }),

  getCopyTradeProxy: () =>
    get<{ proxy: string; configured: boolean }>('/copytrade/proxy'),

  async setCopyTradeProxy(
    proxy: string
  ): Promise<{ proxy: string; configured: boolean }> {
    const r = await httpClient.request<{ proxy: string; configured: boolean }>(
      `${API_BASE}/copytrade/proxy`,
      { method: 'PUT', data: { proxy }, silent: true }
    )
    return unwrap(r, 'Save failed')
  },

  async testCopyTradeProxy(proxy: string): Promise<{
    ok: boolean
    error?: string
    latency_ms: number
    traders?: number
  }> {
    const r = await httpClient.request<{
      ok: boolean
      error?: string
      latency_ms: number
      traders?: number
    }>(`${API_BASE}/copytrade/proxy/test`, {
      method: 'POST',
      data: { proxy },
      silent: true,
      timeout: 40000,
    })
    return unwrap(r, 'Test failed')
  },
}
