import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import { api } from '../lib/api'
import type { CopyTradeStatus, TraderSnapshot } from '../lib/api/copyTrade'
import { ROUTES } from '../router/paths'
import { tr, ui } from '../components/market/marketUi'
import { DiscoverTab } from '../components/copytrade/DiscoverTab'
import { FollowingTab } from '../components/copytrade/FollowingTab'
import { FeedTab } from '../components/copytrade/FeedTab'
import { CoinsTab } from '../components/copytrade/CoinsTab'
import { ago } from '../components/copytrade/format'

type Tab = 'discover' | 'following' | 'feed' | 'coins'
const POLL_MS = 30000

function StatusBar({
  language,
  status,
}: {
  language: string
  status: CopyTradeStatus | null
}) {
  const navigate = useNavigate()
  if (!status) return null
  const c = status.client
  const paused = c.paused && c.paused_until
  const formatErrors = c.format_errors || []
  const dot =
    paused || formatErrors.length
      ? 'bg-nofx-danger'
      : c.last_error
        ? 'bg-nofx-gold'
        : 'bg-nofx-success'
  return (
    <div
      className={`${ui.panel} mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm`}
    >
      <span className="flex items-center gap-1.5 font-medium text-nofx-text">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {paused
          ? tr(
              language,
              `被币安限流，暂停到 ${new Date(c.paused_until!).toLocaleTimeString()}`,
              `Rate limited by Binance; paused until ${new Date(c.paused_until!).toLocaleTimeString()}`
            )
          : formatErrors.length
            ? tr(language, '币安数据格式异常', 'Binance data looks wrong')
            : c.last_error
              ? tr(language, '最近一次请求出错', 'Last request failed')
              : tr(language, '正常', 'OK')}
      </span>
      <span className={ui.muted}>
        {tr(
          language,
          `关注 ${status.follows}/${status.max_follows} 人 · ${status.hot} 人活跃`,
          `Following ${status.follows}/${status.max_follows} · ${status.hot} active`
        )}
      </span>
      <span className={ui.muted}>
        {tr(
          language,
          `每分钟 ${c.requests_per_min} 次请求`,
          `${c.requests_per_min} requests/min`
        )}
      </span>
      {status.oldest_update && !status.oldest_update.startsWith('0001') ? (
        <span className={ui.muted}>
          {tr(
            language,
            `最久未更新：${ago(language, Date.parse(status.oldest_update))}`,
            `Stalest: ${ago(language, Date.parse(status.oldest_update))}`
          )}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => navigate(`${ROUTES.settings}?tab=data`)}
        className="ml-auto inline-flex items-center gap-1 text-xs text-nofx-text-muted hover:text-nofx-gold"
      >
        <Settings className="h-3 w-3" />
        {c.proxy
          ? tr(language, `走代理 ${c.proxy}`, `Via proxy ${c.proxy}`)
          : tr(language, '使用服务器 IP', 'Server IP')}
      </button>
      {formatErrors.length ? (
        <p role="alert" className="w-full text-xs text-nofx-danger">
          {tr(
            language,
            '币安返回的数据缺少价格、时间等字段，可能改了接口格式。在修好之前，受影响的数据不会更新，页面上的数字可能是旧的：',
            'Binance answered without fields such as price or time; the format may have changed. Until fixed, the affected data stops updating and figures may be stale: '
          )}
          {formatErrors.join('；')}
        </p>
      ) : null}
      {c.last_error && !paused && !formatErrors.length ? (
        <p role="alert" className="w-full text-xs text-nofx-danger">
          {c.last_error}
        </p>
      ) : null}
    </div>
  )
}

export function CopyTradePage() {
  const { language } = useLanguage()
  const [tab, setTab] = useState<Tab>('following')
  const [status, setStatus] = useState<CopyTradeStatus | null>(null)
  const [snaps, setSnaps] = useState<TraderSnapshot[]>([])
  const [version, setVersion] = useState(0)
  const [coin, setCoin] = useState('')

  const poll = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        api.getCopyTradeStatus(),
        api.getFollows(),
      ])
      setStatus(s)
      setSnaps(f.follows || [])
      setVersion((v) => v + 1)
    } catch {
      // keep the last view; the status bar shows request problems
    }
  }, [])
  useEffect(() => {
    void poll()
    const t = window.setInterval(
      () => document.visibilityState === 'visible' && void poll(),
      POLL_MS
    )
    return () => window.clearInterval(t)
  }, [poll])

  const followed = useMemo(
    () => new Set(snaps.map((s) => s.trader.portfolio_id)),
    [snaps]
  )
  const openCoin = (symbol: string) => {
    setCoin(symbol)
    setTab('coins')
  }
  const tabs: { id: Tab; zh: string; en: string }[] = [
    { id: 'discover', zh: '发现交易员', en: 'Discover' },
    {
      id: 'following',
      zh: `我的关注 (${snaps.length})`,
      en: `Following (${snaps.length})`,
    },
    { id: 'feed', zh: '实时动态', en: 'Live feed' },
    { id: 'coins', zh: '按币种', en: 'By coin' },
  ]

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 md:px-5">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-nofx-text">
          {tr(language, '带单监控', 'Copy-trade monitor')}
        </h1>
        <p className={ui.muted}>
          {tr(
            language,
            '关注币安合约带单员，查看他们的持仓、开平仓动作，以及每个币上的多空分布和开仓价。数据读取币安网页，有 1–3 分钟延迟，只供参考。',
            'Follow Binance futures lead traders: their positions, actions, and per-coin long/short split and entries. Read from binance.com with a 1–3 minute delay; for reference only.'
          )}
        </p>
      </header>
      <StatusBar language={language} status={status} />
      <nav
        className="mb-4 flex flex-wrap gap-2"
        aria-label={tr(language, '带单监控', 'Copy-trade monitor')}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === tab}
            onClick={() => setTab(t.id)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${t.id === tab ? 'border-nofx-gold bg-nofx-gold/10 text-nofx-text' : `${ui.border} bg-nofx-bg-lighter text-nofx-text hover:border-nofx-gold`}`}
          >
            {tr(language, t.zh, t.en)}
          </button>
        ))}
      </nav>
      {tab === 'discover' ? (
        <DiscoverTab
          language={language}
          followed={followed}
          onFollowed={() => void poll()}
        />
      ) : null}
      {tab === 'following' ? (
        <FollowingTab
          language={language}
          snaps={snaps}
          onChanged={() => void poll()}
          onSymbol={openCoin}
        />
      ) : null}
      {tab === 'feed' ? (
        <FeedTab
          language={language}
          snaps={snaps}
          version={version}
          onSymbol={openCoin}
        />
      ) : null}
      {tab === 'coins' ? (
        <CoinsTab
          language={language}
          version={version}
          selected={coin}
          onSelect={setCoin}
        />
      ) : null}
    </div>
  )
}
