import { useEffect, useState } from 'react'
import { planningAPI } from '../../lib/planning'
import { formatRequestError } from '../../lib/requestErrors'
import { useLanguage } from '../../contexts/LanguageContext'

function useSafeLanguage() {
  try {
    return useLanguage().language
  } catch {
    return 'en' as const
  }
}

type Board = {
  coins: {
    pair: string
    score: number
    return_7d?: number
    volume_ratio?: number
  }[]
  scanned?: number
  fetched_at: string
}

// Free trend board built from public Binance candles. It replaces the paid
// Claw402 AI500 board and keeps its long-only entry policy ("ai500" group).
export function PlanningTrendBoard({
  venue,
  onSelect,
  disabled,
  selected,
  onMarkets,
}: {
  venue: string
  onSelect: (symbol: string) => void
  disabled: boolean
  selected?: string
  onMarkets?: (symbols: string[]) => void
}) {
  const language = useSafeLanguage()
  const zh = language === 'zh'
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (venue !== 'binance') return
    let current = true
    setLoading(true)
    setError('')
    planningAPI<Board>('ai500')
      .then((v) => {
        if (
          !Array.isArray(v.coins) ||
          v.coins.some(
            (c) => typeof c.pair !== 'string' || !Number.isFinite(c.score)
          )
        )
          throw new Error('Invalid trend board response')
        if (current) {
          setBoard(v)
          onMarkets?.(v.coins.map((coin) => coin.pair))
        }
      })
      .catch((e) => {
        if (current) setError(formatRequestError(e, zh ? 'zh' : 'en'))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [venue, revision, onMarkets, zh])
  if (venue !== 'binance') return null
  const coins =
    board?.coins.filter((v) =>
      v.pair.toLowerCase().includes(search.toLowerCase())
    ) || []
  return (
    <section
      className="planning-ai500"
      aria-label={zh ? '币安趋势榜' : 'Binance trend board'}
    >
      <div>
        <b>{zh ? '趋势榜' : 'Trend board'}</b>
        <small>
          {zh
            ? '免费 · 币安公开 K 线计算 · 缓存 5 分钟'
            : 'Free · computed from public Binance candles · cached 5 min'}
        </small>
        <small>
          {zh
            ? '做多入场 · 市价或回调机会'
            : 'Long entries · market or pullback opportunities'}
        </small>
        <input
          aria-label={zh ? '搜索趋势榜' : 'Search trend board'}
          placeholder={zh ? '搜索趋势榜市场' : 'Search trend markets'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          disabled={loading || disabled}
          onClick={() => setRevision((v) => v + 1)}
        >
          {zh ? '刷新列表' : 'Refresh list'}
        </button>
      </div>
      {loading && (
        <p role="status">
          {zh ? '正在扫描趋势榜…' : 'Scanning the trend board…'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && board && (
        <>
          <div className="planning-ai500-symbols">
            {coins.map((v) => (
              <button
                disabled={disabled}
                key={v.pair}
                aria-pressed={selected === v.pair}
                onClick={() => onSelect(v.pair)}
                title={
                  (zh ? '趋势评分 ' : 'Trend score ') +
                  v.score +
                  (Number.isFinite(v.return_7d)
                    ? (zh ? ' · 7 日涨幅 ' : ' · 7d return ') +
                      (Number(v.return_7d) * 100).toFixed(1) +
                      '%'
                    : '')
                }
              >
                {v.pair.replace(/USDT$/, '')}{' '}
                <small>{Number(v.score).toFixed(0)}</small>
              </button>
            ))}
          </div>
          {!coins.length && (
            <small>
              {board.coins.length
                ? zh
                  ? '没有匹配的趋势榜市场。'
                  : 'No matching trend markets.'
                : zh
                  ? '当前没有处于上升趋势的市场。'
                  : 'No market is currently in an uptrend.'}
            </small>
          )}
          <small>
            {zh ? '截至' : 'As of'}{' '}
            {new Date(board.fetched_at).toLocaleTimeString('en-US')} ·{' '}
            {board.coins.length} {zh ? '个上升趋势市场' : 'uptrend markets'}
            {board.scanned
              ? zh
                ? ` · 扫描了成交额前 ${board.scanned} 个`
                : ` · ${board.scanned} most liquid scanned`
              : ''}
          </small>
        </>
      )}
    </section>
  )
}
