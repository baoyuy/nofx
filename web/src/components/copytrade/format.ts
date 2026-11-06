import { tr } from '../market/marketUi'
import type { TradeAction, TradeSide } from '../../lib/api/copyTrade'

export function usd(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : 2 })}`
}

export function signedUsd(v: number): string {
  return (v > 0 ? '+' : '') + usd(v)
}

export function price(v: number): string {
  if (!v) return '--'
  const d = v >= 1000 ? 1 : v >= 1 ? 3 : v >= 0.01 ? 5 : 7
  return v.toLocaleString('en-US', { maximumFractionDigits: d })
}

export function pct(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`
}

export function base(symbol: string): string {
  return symbol.replace(/USDT$/, '')
}

export function ago(language: string, ms: number): string {
  if (!ms) return '--'
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000))
  if (mins < 1) return tr(language, '刚刚', 'just now')
  if (mins < 60) return tr(language, `${mins} 分钟前`, `${mins} min ago`)
  const h = Math.floor(mins / 60)
  if (h < 24) return tr(language, `${h} 小时前`, `${h} h ago`)
  return tr(
    language,
    `${Math.floor(h / 24)} 天前`,
    `${Math.floor(h / 24)} d ago`
  )
}

export function clock(ms: number): string {
  if (!ms) return '--'
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function sideLabel(language: string, side: TradeSide): string {
  return side === 'long'
    ? tr(language, '多', 'Long')
    : tr(language, '空', 'Short')
}

export function sideClass(side: TradeSide): string {
  return side === 'long' ? 'text-nofx-success' : 'text-nofx-danger'
}

export function actionLabel(
  language: string,
  action: TradeAction,
  side: TradeSide
): string {
  const s = sideLabel(language, side)
  switch (action) {
    case 'open':
      return tr(language, `开${s}`, `Open ${s}`)
    case 'add':
      return tr(language, `加${s}`, `Add ${s}`)
    case 'reduce':
      return tr(language, `减${s}`, `Reduce ${s}`)
    default:
      return tr(language, `平${s}`, `Close ${s}`)
  }
}

/** Opening actions are colored by side; closing actions are muted. */
export function actionClass(action: TradeAction, side: TradeSide): string {
  if (action === 'open' || action === 'add') return sideClass(side)
  return 'text-nofx-text-muted'
}

/**
 * How a lead trader trades, from 30 days of fills. An empty string when there
 * is nothing worth showing (too few trades, or the portfolio hides its fills).
 */
export function styleLabel(language: string, kind?: string): string {
  switch (kind) {
    case 'scalp':
      return tr(language, '短线', 'Scalp')
    case 'swing':
      return tr(language, '波段', 'Swing')
    case 'long':
      return tr(language, '长线', 'Long')
    case 'martingale':
      return tr(language, '摊平型', 'Averages down')
    default:
      return ''
  }
}

/** The style tooltip: what the classification is based on. */
export function styleHint(language: string, kind?: string): string {
  switch (kind) {
    case 'scalp':
      return tr(
        language,
        '30 天里多数交易在 4 小时内平掉：仓位是抓拍，不是观点。',
        'Most trades close within 4 hours over 30 days: a snapshot, not a view.'
      )
    case 'swing':
      return tr(
        language,
        '30 天里多数交易持有 4 小时到 3 天。',
        'Most trades are held 4 hours to 3 days over 30 days.'
      )
    case 'long':
      return tr(
        language,
        '30 天里多数交易持有超过 3 天：方向有意义，但入场价已经旧了。',
        'Most trades are held over 3 days: the direction matters, the entry is old.'
      )
    case 'martingale':
      return tr(
        language,
        '亏损时反复加仓、等回本再走：仓位越重越可能是在摊平，票权只算 0.3。',
        'Keeps adding to losing positions and waits to break even: a bigger position means averaging down, so its vote counts 0.3.'
      )
    case 'few_samples':
      return tr(
        language,
        '30 天里完整交易不足 5 笔，看不出风格。',
        'Fewer than 5 completed trades in 30 days: no style to tell.'
      )
    default:
      return ''
  }
}
