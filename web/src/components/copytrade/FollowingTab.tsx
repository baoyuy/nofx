import { Loader2, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import type { TraderSnapshot } from '../../lib/api/copyTrade'
import { confirmToast, notify } from '../../lib/notify'
import { tr, ui } from '../market/marketUi'
import {
  actionClass,
  actionLabel,
  ago,
  base,
  clock,
  pct,
  price,
  sideClass,
  sideLabel,
  signedUsd,
  usd,
} from './format'

function TraderCard({
  snap,
  language,
  onChanged,
  onSymbol,
}: {
  snap: TraderSnapshot
  language: string
  onChanged: () => void
  onSymbol: (symbol: string) => void
}) {
  const t = snap.trader
  const positions = snap.positions || []
  const events = snap.events || []
  const loaded = !snap.updated_at.startsWith('0001')
  const unfollow = async () => {
    const ok = await confirmToast(
      tr(
        language,
        `取消关注「${t.nickname}」？已保存的成交记录会一并删除。`,
        `Unfollow "${t.nickname}"? Stored trades are deleted too.`
      ),
      {
        title: tr(language, '取消关注', 'Unfollow'),
        okText: tr(language, '取消关注', 'Unfollow'),
        cancelText: tr(language, '保留', 'Keep'),
      }
    )
    if (!ok) return
    try {
      await api.unfollow(t.portfolio_id)
      onChanged()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <section className={ui.panel}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        {t.avatar_url ? (
          <img
            src={t.avatar_url}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <a
          href={`https://www.binance.com/zh-CN/copy-trading/lead-details/${t.portfolio_id}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-nofx-text hover:underline"
        >
          {t.nickname || t.portfolio_id}
        </a>
        <span className={ui.muted}>
          {tr(language, '30天', '30d')}{' '}
          <span
            className={t.roi >= 0 ? 'text-nofx-success' : 'text-nofx-danger'}
          >
            {pct(t.roi)}
          </span>
          {' · '}
          {tr(language, '回撤', 'MDD')} {t.mdd.toFixed(1)}% ·{' '}
          {tr(language, '胜率', 'Win')} {t.win_rate.toFixed(0)}%
        </span>
        {t.status && t.status !== 'ACTIVE' ? (
          <span className="rounded bg-nofx-danger/10 px-1.5 text-[11px] text-nofx-danger">
            {t.status}
          </span>
        ) : null}
        <span className={`ml-auto ${ui.muted}`}>
          {loaded
            ? tr(
                language,
                `${ago(language, Date.parse(snap.updated_at))}更新`,
                `updated ${ago(language, Date.parse(snap.updated_at))}`
              )
            : ''}
        </span>
        <button
          type="button"
          className={`${ui.btnGhost} inline-flex items-center gap-1`}
          onClick={() => void unfollow()}
          aria-label={tr(language, '取消关注', 'Unfollow')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </header>
      {snap.error ? (
        <p role="alert" className="mb-2 text-xs text-nofx-danger">
          {snap.error}
        </p>
      ) : null}
      {!loaded && !snap.error ? (
        <p className={`${ui.muted} flex items-center gap-1 py-3`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          {tr(
            language,
            '正在拉取最近 7 天的成交…',
            'Fetching the last 7 days of trades…'
          )}
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-nofx-text">
            {tr(language, '当前持仓', 'Positions')}
            <span
              className={`rounded px-1.5 text-[10px] font-normal ${snap.positions_source === 'public' ? 'bg-nofx-success/10 text-nofx-success' : 'bg-nofx-gold/10 text-nofx-gold'}`}
            >
              {snap.positions_source === 'public'
                ? tr(language, '公开', 'Public')
                : tr(language, '推算', 'Inferred')}
            </span>
          </div>
          {positions.length ? (
            <table className="mb-2 w-full text-xs">
              <tbody className="text-nofx-text">
                {positions.slice(0, 6).map((p) => (
                  <tr key={p.symbol + p.side}>
                    <td className="py-0.5">
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => onSymbol(p.symbol)}
                      >
                        {base(p.symbol)}
                      </button>
                    </td>
                    <td className={sideClass(p.side)}>
                      {sideLabel(language, p.side)}
                    </td>
                    <td>{p.leverage ? `${p.leverage}x` : ''}</td>
                    <td className="tabular-nums">{usd(p.entry_value)}</td>
                    <td className="tabular-nums">@ {price(p.entry_price)}</td>
                    <td
                      className={`tabular-nums ${p.unrealized_pnl ? (p.unrealized_pnl >= 0 ? 'text-nofx-success' : 'text-nofx-danger') : ''}`}
                    >
                      {p.unrealized_pnl ? signedUsd(p.unrealized_pnl) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={`${ui.muted} mb-2`}>
              {snap.positions_source === 'public'
                ? tr(language, '没有持仓', 'No positions')
                : tr(
                    language,
                    '监控以来没有看到未平的仓位',
                    'No open positions seen since monitoring started'
                  )}
            </p>
          )}
          {events.length ? (
            <div className="space-y-0.5 border-t border-[rgba(25,36,52,0.08)] pt-1.5 text-xs">
              {events.slice(0, 3).map((e, i) => (
                <div key={i} className="flex flex-wrap gap-x-2 text-nofx-text">
                  <span className={ui.muted}>{clock(e.time)}</span>
                  <span
                    className={`font-medium ${actionClass(e.action, e.side)}`}
                  >
                    {actionLabel(language, e.action, e.side)}
                  </span>
                  <span>{base(e.symbol)}</span>
                  <span className="tabular-nums">
                    {usd(e.value)} @ {price(e.price)}
                  </span>
                  {e.realized_pnl ? (
                    <span
                      className={
                        e.realized_pnl >= 0
                          ? 'text-nofx-success'
                          : 'text-nofx-danger'
                      }
                    >
                      {signedUsd(e.realized_pnl)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

export function FollowingTab({
  language,
  snaps,
  onChanged,
  onSymbol,
}: {
  language: string
  snaps: TraderSnapshot[]
  onChanged: () => void
  onSymbol: (symbol: string) => void
}) {
  if (!snaps.length) {
    return (
      <p className={`${ui.panel} py-10 text-center ${ui.muted}`}>
        {tr(
          language,
          '还没有关注任何带单员。到「发现交易员」里挑选，或直接粘贴带单员主页链接。',
          'Not following anyone yet. Pick traders under "Discover", or paste a lead trader page link.'
        )}
      </p>
    )
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {snaps.map((s) => (
        <TraderCard
          key={s.trader.portfolio_id}
          snap={s}
          language={language}
          onChanged={onChanged}
          onSymbol={onSymbol}
        />
      ))}
    </div>
  )
}
