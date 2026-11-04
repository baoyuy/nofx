import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import type { SymbolSummary } from '../../lib/api/copyTrade'
import {
  COPY_TRADE_LIMITS,
  DEFAULT_COPY_TRADE,
  type CopyDirection,
  type CopyTradeSettings,
} from '../../lib/strategyForm'
import { ROUTES } from '../../router/paths'
import { Field, NumberInput, text } from './StrategyEditorParts'

/**
 * Coins the copy_trade source would pick now, as the backend does: the
 * leading side matches the direction, enough traders, confidence high
 * enough, highest confidence first. (The backend also drops traders not
 * refreshed for 30 minutes and, off Hyperliquid, stock contracts.)
 */
export function pickCopyTradeCoins(
  coins: SymbolSummary[],
  s: CopyTradeSettings
): SymbolSummary[] {
  return coins
    .filter((c) => {
      const dir = c.confidence?.direction
      return (
        dir !== undefined &&
        dir !== 'neutral' &&
        c.confidence.score >= s.minConfidence &&
        (s.direction === 'both' || dir === s.direction) &&
        c.long.traders + c.short.traders >= s.minTraders
      )
    })
    .sort((a, b) => b.confidence.score - a.confidence.score)
    .slice(0, s.limit)
}

const choice = (active: boolean) =>
  `flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${active ? 'border-nofx-gold bg-nofx-gold/10 text-nofx-text' : 'border-[rgba(25,36,52,0.14)] text-nofx-text-muted'}`

export function CopyTradeSourcePanel({
  language,
  settings,
  onChange,
}: {
  language: string
  settings?: CopyTradeSettings
  onChange: (s: CopyTradeSettings) => void
}) {
  const navigate = useNavigate()
  const s = { ...DEFAULT_COPY_TRADE, ...(settings || {}) }
  const set = (patch: Partial<CopyTradeSettings>) =>
    onChange({ ...s, ...patch })
  const [coins, setCoins] = useState<SymbolSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    api
      .getCopyTradeSymbols()
      .then((r) => alive && setCoins(r.symbols || []))
      .catch((e) => alive && setError(String(e?.message || e)))
    return () => {
      alive = false
    }
  }, [])
  const picked = coins ? pickCopyTradeCoins(coins, s) : []

  return (
    <>
      <p className="text-xs text-nofx-text-muted">
        {text(
          language,
          '每轮决策前，从「带单」页关注的带单员当前持仓里选币：按多空方向置信度从高到低，交给 AI。AI 同时会看到每个币上带单员的多空人数、均价、被套和新开情况，但仍然按 K 线和指标自己判断，不会照抄带单员。持仓中的币掉出名单后，AI 仍会继续管理直到平仓。',
          'Before each cycle, coins are picked from what the lead traders you follow on the Copy trade page hold, highest direction confidence first. The AI also sees, per coin, how many hold long or short, their average entry, and who is trapped or fresh, but still decides from candles and indicators instead of copying them. Held coins that drop off are still managed until closed.'
        )}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          language={language}
          label={text(language, '带单员偏向', 'Lead traders lean')}
          hint={text(
            language,
            '只选带单员偏多或偏空的币。AI 开仓方向仍由它自己决定。',
            'Only coins the lead traders lean long or short on. The AI still picks its own side.'
          )}
        >
          <div className="flex gap-2" role="radiogroup">
            {(
              [
                ['both', text(language, '都要', 'Both')],
                ['long', text(language, '偏多', 'Long')],
                ['short', text(language, '偏空', 'Short')],
              ] as [CopyDirection, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={s.direction === v}
                onClick={() => set({ direction: v })}
                className={choice(s.direction === v)}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field
          language={language}
          label={text(language, '置信度不低于', 'Min confidence')}
          hint={text(
            language,
            '带单页「按币种」里的置信度，0–100。越高越少但越一致。',
            'The confidence on the Copy trade coin view, 0-100. Higher means fewer but more agreed coins.'
          )}
        >
          <NumberInput
            value={s.minConfidence}
            range={COPY_TRADE_LIMITS.minConfidence}
            onChange={(v) => set({ minConfidence: v })}
          />
        </Field>
        <Field
          language={language}
          label={text(language, '至少几个带单员持有', 'Min lead traders')}
          hint={text(
            language,
            '只有一两个人持有的币，说明不了什么。',
            'A coin held by one or two traders says little.'
          )}
        >
          <NumberInput
            value={s.minTraders}
            range={COPY_TRADE_LIMITS.minTraders}
            suffix={text(language, '人', '')}
            onChange={(v) => set({ minTraders: v })}
          />
        </Field>
        <Field
          language={language}
          label={text(language, '最多选几个币', 'Max coins')}
          hint={text(
            language,
            '币越多，每轮花的 token 越多。',
            'More coins cost more tokens per cycle.'
          )}
        >
          <NumberInput
            value={s.limit}
            range={COPY_TRADE_LIMITS.limit}
            onChange={(v) => set({ limit: v })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="text-xs text-nofx-text-muted">
          {text(language, '当前会交易：', 'Would trade now:')}
        </span>
        {error ? (
          <span className="text-xs text-nofx-danger">
            {text(
              language,
              '读取带单数据失败，请稍后再试。',
              'Could not read copy-trade data; try again later.'
            )}
          </span>
        ) : !coins ? (
          <span className="text-xs text-nofx-text-muted">
            {text(language, '正在读取带单数据…', 'Reading copy-trade data…')}
          </span>
        ) : picked.length === 0 ? (
          <span className="text-xs text-nofx-text-muted">
            {coins.length
              ? text(
                  language,
                  '现在没有符合条件的币，本轮只会管理已有持仓。可以放宽置信度或人数。',
                  'No coin passes now; the cycle only manages open positions. Try a lower confidence or fewer traders.'
                )
              : text(
                  language,
                  '关注的带单员现在都没有持仓。先去「带单」页关注一些带单员。',
                  'Followed lead traders hold nothing now. Follow some on the Copy trade page first.'
                )}
          </span>
        ) : (
          picked.map((c) => (
            <span
              key={c.symbol}
              className="rounded-md bg-nofx-gold/10 px-2 py-1 text-xs font-medium text-nofx-gold"
              title={text(
                language,
                `做多 ${c.long.traders} 人、做空 ${c.short.traders} 人`,
                `${c.long.traders} long, ${c.short.traders} short`
              )}
            >
              {c.symbol.replace(/USDT$/, '')}
              <span
                className={`ml-1 font-normal ${c.confidence.direction === 'long' ? 'text-nofx-success' : 'text-nofx-danger'}`}
              >
                {c.confidence.direction === 'long'
                  ? text(language, '偏多', 'long')
                  : text(language, '偏空', 'short')}{' '}
                {c.confidence.score.toFixed(0)}
              </span>
            </span>
          ))
        )}
        <button
          type="button"
          onClick={() => navigate(ROUTES.copyTrade)}
          className="text-xs text-nofx-gold underline"
        >
          {text(language, '去带单页查看', 'Open the Copy trade page')}
        </button>
      </div>
      <p className="text-xs text-nofx-text-muted">
        {text(
          language,
          '股票类合约（如 SNDK、MU、AAPL）只在 Hyperliquid 上有，用币安或模拟盘的交易员会自动跳过它们。',
          'Stock contracts (SNDK, MU, AAPL…) exist only on Hyperliquid; Binance and paper traders skip them automatically.'
        )}
      </p>
    </>
  )
}

/** Opt-in for every other coin source. */
export function CopyTradeContextToggle({
  language,
  checked,
  onChange,
}: {
  language: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 rounded-lg border border-[rgba(25,36,52,0.14)] px-3 py-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-semibold text-nofx-text">
          {text(language, '附带带单参考', 'Include lead-trader context')}
        </span>
        <span className="block text-xs text-nofx-text-muted">
          {text(
            language,
            '每个候选币和持仓币，AI 都会看到关注的带单员在这个币上的多空、均价、被套和最近动作，作为参考信号。没人持有的币不显示。',
            'For every candidate and held coin, the AI also sees what your followed lead traders hold there: sides, average entry, trapped or fresh, recent actions. Coins nobody holds show nothing.'
          )}
        </span>
      </span>
    </label>
  )
}
