import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type { Holder, SymbolSummary } from '../../lib/api/copyTrade'
import type { MarketKline } from '../../lib/api/market'
import { BinanceChart, BN, type PriceMarker } from '../market/BinanceChart'
import { tr, ui } from '../market/marketUi'
import { priceDecimals } from '../../utils/marketIndicators'
import {
  ago,
  base,
  clock,
  price,
  sideClass,
  sideLabel,
  signedUsd,
  usd,
} from './format'

const intervals = ['15m', '1h', '4h', '1d']
// More lines than this make the chart unreadable.
const MAX_MARKERS = 20

function Bar({ s }: { s: SymbolSummary }) {
  const total = s.long.value + s.short.value || 1
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded bg-nofx-bg-deeper">
      <div
        className="bg-nofx-success"
        style={{ width: `${(s.long.value / total) * 100}%` }}
      />
      <div
        className="bg-nofx-danger"
        style={{ width: `${(s.short.value / total) * 100}%` }}
      />
    </div>
  )
}

function CoinDetail({
  language,
  symbol,
  version,
}: {
  language: string
  symbol: string
  version: number
}) {
  const [interval, setChartInterval] = useState('1h')
  const [candles, setCandles] = useState<MarketKline[]>([])
  const [chartError, setChartError] = useState('')
  const [holders, setHolders] = useState<Holder[]>([])
  const [summary, setSummary] = useState<SymbolSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    setCandles([])
    api
      .getMarketKlines(symbol, interval, 300)
      .then((k) => {
        if (!cancelled) {
          setCandles(k)
          setChartError('')
        }
      })
      .catch(
        (e) =>
          !cancelled &&
          setChartError(e instanceof Error ? e.message : String(e))
      )
    return () => {
      cancelled = true
    }
  }, [symbol, interval])

  useEffect(() => {
    let cancelled = false
    api
      .getCopyTradeSymbol(symbol)
      .then((r) => {
        if (!cancelled) {
          setHolders(r.holders || [])
          setSummary(r.summary)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [symbol, version])

  const last = candles[candles.length - 1]?.close || 0
  const markers = useMemo<PriceMarker[]>(() => {
    const top = holders.slice(0, MAX_MARKERS)
    const maxValue = Math.max(1, ...top.map((h) => h.entry_value))
    const lines: PriceMarker[] = top.map((h) => ({
      price: h.entry_price,
      color: h.side === 'long' ? BN.up : BN.down,
      width: 1 + Math.round((h.entry_value / maxValue) * 3),
      title: `${h.nickname.slice(0, 8)} ${usd(h.entry_value)}`,
    }))
    if (summary?.long.avg_entry)
      lines.push({
        price: summary.long.avg_entry,
        color: BN.line1,
        width: 2,
        title: tr(language, '多头均价', 'Long avg'),
      })
    if (summary?.short.avg_entry)
      lines.push({
        price: summary.short.avg_entry,
        color: BN.line2,
        width: 2,
        title: tr(language, '空头均价', 'Short avg'),
      })
    return lines
  }, [holders, summary, language])

  return (
    <div className="space-y-3">
      <section className={ui.panel}>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-nofx-text">
            {base(symbol)}
          </h2>
          <span className="tabular-nums text-nofx-text">{price(last)}</span>
          {summary ? (
            <span className={ui.muted}>
              <span className="text-nofx-success">
                {tr(
                  language,
                  `做多 ${summary.long.traders} 人`,
                  `${summary.long.traders} long`
                )}{' '}
                · {usd(summary.long.value)}
                {summary.long.avg_entry
                  ? ` · ${tr(language, '均价', 'avg')} ${price(summary.long.avg_entry)}`
                  : ''}
              </span>
              {'　'}
              <span className="text-nofx-danger">
                {tr(
                  language,
                  `做空 ${summary.short.traders} 人`,
                  `${summary.short.traders} short`
                )}{' '}
                · {usd(summary.short.value)}
                {summary.short.avg_entry
                  ? ` · ${tr(language, '均价', 'avg')} ${price(summary.short.avg_entry)}`
                  : ''}
              </span>
            </span>
          ) : null}
          <div className="ml-auto flex gap-1">
            {intervals.map((iv) => (
              <button
                key={iv}
                type="button"
                aria-pressed={iv === interval}
                className={`${ui.btnGhost} ${iv === interval ? 'border-nofx-gold text-nofx-gold' : ''}`}
                onClick={() => setChartInterval(iv)}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
        <p className={`${ui.muted} mb-2`}>
          {tr(
            language,
            `图上每条线是一位带单员的开仓价，绿色做多、红色做空，线越粗仓位越大（最多显示前 ${MAX_MARKERS} 位）；橙色和紫色是多空的平均开仓价。`,
            `Each line is a trader's entry: green long, red short, thicker = larger (top ${MAX_MARKERS}); orange and purple are the long and short average entries.`
          )}
        </p>
        {chartError ? (
          <p
            role="alert"
            className="py-10 text-center text-sm text-nofx-danger"
          >
            {chartError}
          </p>
        ) : (
          <BinanceChart
            candles={candles}
            decimals={priceDecimals(last || 1)}
            main="NONE"
            subs={['VOL']}
            markers={markers}
            resetKey={`${symbol}:${interval}`}
            height={520}
          />
        )}
      </section>

      <section className={ui.panel}>
        <h3 className={ui.title}>
          {tr(language, '持有这个币的带单员', 'Followed traders holding it')}
        </h3>
        {holders.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-nofx-text-muted">
                <tr>
                  <th className="py-1.5 font-normal">
                    {tr(language, '带单员', 'Trader')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '方向', 'Side')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '开仓价', 'Entry')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '仓位价值', 'Value')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '杠杆', 'Lev.')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '保证金', 'Margin')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '浮盈亏', 'uPnL')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '入场时间', 'Opened')}
                  </th>
                  <th className="font-normal">
                    {tr(language, '来源', 'Source')}
                  </th>
                </tr>
              </thead>
              <tbody className="text-nofx-text">
                {holders.map((h) => {
                  // Inferred positions have no exchange PnL; estimate from the last candle.
                  const upnl =
                    h.unrealized_pnl ||
                    (last
                      ? (h.side === 'long' ? 1 : -1) *
                        (last - h.entry_price) *
                        h.qty
                      : 0)
                  return (
                    <tr
                      key={h.portfolio_id + h.side}
                      className={`border-t ${ui.border}`}
                    >
                      <td className="py-1.5">{h.nickname}</td>
                      <td className={sideClass(h.side)}>
                        {sideLabel(language, h.side)}
                      </td>
                      <td className="tabular-nums">{price(h.entry_price)}</td>
                      <td className="tabular-nums">{usd(h.entry_value)}</td>
                      <td>{h.leverage ? `${h.leverage}x` : '--'}</td>
                      <td className="tabular-nums">
                        {h.margin ? usd(h.margin) : '--'}
                      </td>
                      <td
                        className={`tabular-nums ${upnl >= 0 ? 'text-nofx-success' : 'text-nofx-danger'}`}
                      >
                        {upnl ? signedUsd(upnl) : '--'}
                      </td>
                      <td
                        className="tabular-nums"
                        title={h.opened_at ? ago(language, h.opened_at) : ''}
                      >
                        {h.opened_at
                          ? clock(h.opened_at)
                          : tr(language, '早于监控', 'Before monitoring')}
                      </td>
                      <td>
                        <span
                          className={`rounded px-1.5 text-[10px] ${h.source === 'public' ? 'bg-nofx-success/10 text-nofx-success' : 'bg-nofx-gold/10 text-nofx-gold'}`}
                        >
                          {h.source === 'public'
                            ? tr(language, '公开', 'Public')
                            : tr(language, '推算', 'Inferred')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={ui.muted}>
            {tr(
              language,
              '关注的带单员现在都没有持有这个币。',
              'No followed trader holds this coin now.'
            )}
          </p>
        )}
        <p className={`${ui.muted} mt-2`}>
          {tr(
            language,
            '「推算」的仓位由成交记录算出：开仓价和金额是准确的，但看不到杠杆和保证金，浮盈亏按最新 K 线估算。',
            '"Inferred" positions come from trades: entry and value are exact, leverage and margin are unknown, and uPnL is estimated from the latest candle.'
          )}
        </p>
      </section>
    </div>
  )
}

export function CoinsTab({
  language,
  version,
  selected,
  onSelect,
}: {
  language: string
  version: number
  selected: string
  onSelect: (symbol: string) => void
}) {
  const [symbols, setSymbols] = useState<SymbolSummary[]>([])
  useEffect(() => {
    let cancelled = false
    api
      .getCopyTradeSymbols()
      .then((r) => !cancelled && setSymbols(r.symbols || []))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [version])
  const current = selected || symbols[0]?.symbol || ''

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className={`${ui.panel} max-h-[900px] overflow-y-auto`}>
        <h2 className={ui.title}>
          {tr(language, '关注的人在做的币', 'Coins followed traders hold')}
        </h2>
        {symbols.length ? (
          <ul className="space-y-1">
            {symbols.map((s) => (
              <li key={s.symbol}>
                <button
                  type="button"
                  aria-pressed={s.symbol === current}
                  onClick={() => onSelect(s.symbol)}
                  className={`w-full rounded-lg border px-2 py-1.5 text-left ${s.symbol === current ? 'border-nofx-gold bg-nofx-gold/10' : 'border-transparent hover:border-nofx-gold'}`}
                >
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-nofx-text">
                      {base(s.symbol)}
                    </span>
                    <span className="text-xs">
                      <span className="text-nofx-success">
                        {s.long.traders}
                        {tr(language, '多', 'L')}
                      </span>
                      {' / '}
                      <span className="text-nofx-danger">
                        {s.short.traders}
                        {tr(language, '空', 'S')}
                      </span>
                    </span>
                  </div>
                  <Bar s={s} />
                  <div className={`${ui.muted} mt-0.5`}>
                    {usd(s.long.value + s.short.value)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.muted}>
            {tr(
              language,
              '关注的带单员现在都没有持仓。',
              'No followed trader holds anything now.'
            )}
          </p>
        )}
      </aside>
      <div className="min-w-0">
        {current ? (
          <CoinDetail language={language} symbol={current} version={version} />
        ) : (
          <p className={`${ui.panel} py-10 text-center ${ui.muted}`}>
            {tr(
              language,
              '有持仓后，这里会显示每个币的多空分布和各人的开仓价。',
              'Once traders hold positions, each coin shows its long/short split and entries here.'
            )}
          </p>
        )}
      </div>
    </div>
  )
}
