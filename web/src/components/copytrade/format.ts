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
