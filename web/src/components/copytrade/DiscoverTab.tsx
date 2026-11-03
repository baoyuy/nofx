import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import type { Leader, LeaderPage } from '../../lib/api/copyTrade'
import { notify } from '../../lib/notify'
import { tr, ui } from '../market/marketUi'
import { pct, usd } from './format'

function Sparkline({ points }: { points: Leader['chartItems'] }) {
  const values = (points || []).map((p) => Number(p.value) || 0)
  if (values.length < 2) return <span className={ui.muted}>--</span>
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const d = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 80},${22 - ((v - lo) / span) * 20}`
    )
    .join(' ')
  const up = values[values.length - 1] >= values[0]
  return (
    <svg width="80" height="24" aria-hidden>
      <polyline
        points={d}
        fill="none"
        strokeWidth="1.5"
        stroke={
          up
            ? 'var(--color-nofx-success, #2e8b57)'
            : 'var(--color-nofx-danger, #d6433a)'
        }
      />
    </svg>
  )
}

export function DiscoverTab({
  language,
  followed,
  onFollowed,
}: {
  language: string
  followed: Set<string>
  onFollowed: () => void
}) {
  const [timeRange, setTimeRange] = useState('30D')
  const [sort, setSort] = useState('COPIER_PNL')
  const [page, setPage] = useState(1)
  const [maxMdd, setMaxMdd] = useState(30)
  const [minWin, setMinWin] = useState(0)
  const [cryptoOnly, setCryptoOnly] = useState(false)
  const [data, setData] = useState<LeaderPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [idInput, setIdInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.getLeaderboard(timeRange, sort, page))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [timeRange, sort, page])
  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () =>
      (data?.list || []).filter(
        (r) =>
          (maxMdd >= 100 || r.mdd <= maxMdd) &&
          r.winRate >= minWin &&
          (!cryptoOnly || !r.tradFiTag)
      ),
    [data, maxMdd, minWin, cryptoOnly]
  )

  const follow = async (id: string) => {
    setBusy(id)
    try {
      const f = await api.follow(id)
      notify.success(
        tr(
          language,
          `已关注 ${f.nickname}，正在拉取最近 7 天的成交`,
          `Following ${f.nickname}; fetching the last 7 days of trades`
        )
      )
      setIdInput('')
      onFollowed()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const select = (
    value: string,
    set: (v: string) => void,
    options: [string, string][]
  ) => (
    <select
      className={`${ui.inputInline}`}
      value={value}
      onChange={(e) => {
        set(e.target.value)
        setPage(1)
      }}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )

  return (
    <div className="space-y-3">
      <section className={ui.panel}>
        <h2 className={ui.title}>
          {tr(language, '按 ID 或链接关注', 'Follow by ID or link')}
        </h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (idInput.trim()) void follow(idInput.trim())
          }}
        >
          <input
            className={`${ui.inputInline} min-w-[260px] flex-1`}
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            placeholder={tr(
              language,
              '粘贴带单员主页链接，或填入数字 ID',
              'Paste a lead trader page link or the numeric ID'
            )}
          />
          <button
            type="submit"
            className={`${ui.btnGold} w-auto`}
            disabled={!idInput.trim() || Boolean(busy)}
          >
            {tr(language, '关注', 'Follow')}
          </button>
        </form>
      </section>

      <section className={ui.panel}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label>
            <span className={ui.label}>
              {tr(language, '时间范围', 'Period')}
            </span>
            {select(timeRange, setTimeRange, [
              ['7D', tr(language, '7 天', '7 days')],
              ['30D', tr(language, '30 天', '30 days')],
              ['90D', tr(language, '90 天', '90 days')],
            ])}
          </label>
          <label>
            <span className={ui.label}>{tr(language, '排序', 'Sort by')}</span>
            {select(sort, setSort, [
              ['COPIER_PNL', tr(language, '跟单者收益', 'Copier PnL')],
              ['ROI', tr(language, '收益率', 'ROI')],
              ['PNL', tr(language, '盈利额', 'PnL')],
            ])}
          </label>
          <label>
            <span className={ui.label}>
              {tr(language, '最大回撤不超过', 'Max drawdown ≤')}
            </span>
            <select
              className={`${ui.inputInline}`}
              value={maxMdd}
              onChange={(e) => setMaxMdd(Number(e.target.value))}
            >
              {[10, 20, 30, 50, 100].map((v) => (
                <option key={v} value={v}>
                  {v >= 100 ? tr(language, '不限', 'Any') : `${v}%`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={ui.label}>
              {tr(language, '胜率不低于', 'Win rate ≥')}
            </span>
            <select
              className={`${ui.inputInline}`}
              value={minWin}
              onChange={(e) => setMinWin(Number(e.target.value))}
            >
              {[0, 40, 50, 60, 70].map((v) => (
                <option key={v} value={v}>
                  {v ? `${v}%` : tr(language, '不限', 'Any')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-sm text-nofx-text">
            <input
              type="checkbox"
              checked={cryptoOnly}
              onChange={(e) => setCryptoOnly(e.target.checked)}
            />
            {tr(language, '排除做股票合约的', 'Hide stock-contract traders')}
          </label>
          <button
            type="button"
            className={`${ui.btnGhost} mb-1 ml-auto inline-flex items-center gap-1`}
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {tr(language, '刷新', 'Refresh')}
          </button>
        </div>
        <p className={`${ui.muted} mb-2`}>
          {tr(
            language,
            `币安每页最多返回 30 人，回撤和胜率筛选只作用于当前页。本页显示 ${rows.length} / ${data?.list.length || 0} 人，共 ${data?.total || 0} 位带单员。榜单每 10 分钟更新一次。`,
            `Binance returns 30 traders per page; drawdown and win-rate filters apply to this page only. Showing ${rows.length} / ${data?.list.length || 0} of ${data?.total || 0} lead traders. Refreshed every 10 minutes.`
          )}
        </p>
        {error ? (
          <p role="alert" className="py-6 text-center text-sm text-nofx-danger">
            {error}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-nofx-text-muted">
              <tr>
                <th className="py-2 font-normal">
                  {tr(language, '带单员', 'Trader')}
                </th>
                <th className="font-normal">{tr(language, '收益率', 'ROI')}</th>
                <th className="font-normal">{tr(language, '盈利', 'PnL')}</th>
                <th className="font-normal">
                  {tr(language, '最大回撤', 'MDD')}
                </th>
                <th className="font-normal">{tr(language, '胜率', 'Win')}</th>
                <th className="font-normal">
                  {tr(language, '跟单者收益', 'Copier PnL')}
                </th>
                <th className="font-normal">
                  {tr(language, '管理资金', 'AUM')}
                </th>
                <th className="font-normal">
                  {tr(language, '跟单人数', 'Copiers')}
                </th>
                <th className="font-normal">
                  {tr(language, '收益曲线', 'Curve')}
                </th>
                <th />
              </tr>
            </thead>
            <tbody className="text-nofx-text">
              {rows.map((r) => (
                <tr key={r.leadPortfolioId} className={`border-t ${ui.border}`}>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={r.avatarUrl}
                        alt=""
                        className="h-7 w-7 rounded-full"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <div className="font-medium">{r.nickname}</div>
                        <div className="flex gap-1 text-[10px] text-nofx-text-muted">
                          {r.apiKeyTag ? (
                            <span className="rounded bg-nofx-bg-deeper px-1">
                              API
                            </span>
                          ) : null}
                          {r.tradFiTag ? (
                            <span className="rounded bg-nofx-bg-deeper px-1">
                              {tr(language, '含股票合约', 'Stocks')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td
                    className={
                      r.roi >= 0 ? 'text-nofx-success' : 'text-nofx-danger'
                    }
                  >
                    {pct(r.roi)}
                  </td>
                  <td>{usd(r.pnl)}</td>
                  <td className={r.mdd > 30 ? 'text-nofx-danger' : ''}>
                    {r.mdd.toFixed(1)}%
                  </td>
                  <td>{r.winRate.toFixed(0)}%</td>
                  <td>{usd(r.copierPnl)}</td>
                  <td>{usd(r.aum)}</td>
                  <td className="tabular-nums">
                    {r.currentCopyCount}/{r.maxCopyCount}
                  </td>
                  <td>
                    <Sparkline points={r.chartItems} />
                  </td>
                  <td className="text-right">
                    {followed.has(r.leadPortfolioId) ? (
                      <span className={ui.muted}>
                        {tr(language, '已关注', 'Following')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`${ui.btnGhost} inline-flex items-center gap-1`}
                        disabled={Boolean(busy)}
                        onClick={() => void follow(r.leadPortfolioId)}
                      >
                        {busy === r.leadPortfolioId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        {tr(language, '关注', 'Follow')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            className={ui.btnGhost}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            {tr(language, '上一页', 'Previous')}
          </button>
          <span className={ui.muted}>
            {tr(language, `第 ${page} 页`, `Page ${page}`)}
          </span>
          <button
            type="button"
            className={ui.btnGhost}
            disabled={loading || (data?.list.length || 0) < 30 || page >= 50}
            onClick={() => setPage((p) => p + 1)}
          >
            {tr(language, '下一页', 'Next')}
          </button>
        </div>
      </section>
    </div>
  )
}
