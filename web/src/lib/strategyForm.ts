import type { AIStrategyConfig, Strategy, StrategyConfig } from '../types'

// Form model of the free strategy editor and its conversion to and from the
// backend StrategyConfig. Limits mirror store/strategy.go ClampLimits, so the
// backend never has to clamp what the editor sends.

export const LIMITS = {
  maxCoins: 10,
  maxExtraTimeframes: 3, // primary + 3 = MaxTimeframes 4
  bars: { min: 10, max: 30 },
  leverage: { min: 1, max: 20 },
  positionRatio: { min: 0.5, max: 10 },
  maxPositions: { min: 1, max: 8 },
  marginUsage: { min: 0.1, max: 1 },
  minPositionSize: { min: 10, max: 1000 },
  confidence: { min: 50, max: 100 },
  riskReward: { min: 1, max: 10 },
} as const

export const timeframeOptions = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '1d',
]

// Indicators the engine computes locally from candles, plus Binance futures
// open interest and funding. All free.
export const indicatorOptions = [
  {
    key: 'enable_ema',
    zh: 'EMA 均线',
    en: 'EMA',
    hintZh: '判断趋势方向',
    hintEn: 'Trend direction',
  },
  {
    key: 'enable_macd',
    zh: 'MACD',
    en: 'MACD',
    hintZh: '动量与拐点',
    hintEn: 'Momentum and turns',
  },
  {
    key: 'enable_rsi',
    zh: 'RSI',
    en: 'RSI',
    hintZh: '超买超卖',
    hintEn: 'Overbought / oversold',
  },
  {
    key: 'enable_atr',
    zh: 'ATR 波动率',
    en: 'ATR',
    hintZh: '设止损距离',
    hintEn: 'Stop distance',
  },
  {
    key: 'enable_boll',
    zh: '布林带',
    en: 'Bollinger',
    hintZh: '波动区间与突破',
    hintEn: 'Range and breakouts',
  },
  {
    key: 'enable_volume',
    zh: '成交量',
    en: 'Volume',
    hintZh: '确认突破力度',
    hintEn: 'Breakout strength',
  },
] as const
export type IndicatorKey = (typeof indicatorOptions)[number]['key']

export const ruleSections = [
  'role_definition',
  'trading_frequency',
  'entry_standards',
  'decision_process',
] as const
export type RuleSection = (typeof ruleSections)[number]

export interface FreeForm {
  name: string
  description: string
  // "pool" trades a saved coin pool from the Coin pool page.
  coinSource?: 'static' | 'pool'
  coinPoolID?: string
  // Snapshot of the pool's coins, sent with the strategy.
  poolCoins?: string[]
  coinsInput: string
  timeframe: string
  // Additional timeframes the AI also sees (multi-timeframe analysis).
  extraTimeframes?: string[]
  bars: number
  // BTC/ETH leverage; altLeverage defaults to it.
  leverage: number
  altLeverage?: number
  // Max position value as a multiple of account equity.
  btcEthPositionRatio?: number
  altPositionRatio?: number
  maxPositions: number
  marginUsage: number
  minPositionSize?: number
  minConfidence: number
  minRiskReward: number
  customPrompt: string
  // Editable rule sections; undefined keeps the saved ones.
  rules?: Partial<Record<RuleSection, string>>
  indicators: Record<IndicatorKey, boolean>
  enableOI?: boolean
  enableFunding?: boolean
}

export const DEFAULT_COINS = 'BTCUSDT, ETHUSDT, SOLUSDT'

// Conservative starting point for new strategies.
export const SAFE_DEFAULTS = {
  leverage: 3,
  maxPositions: 3,
  marginUsage: 0.5,
  minConfidence: 75,
  minRiskReward: 2,
}

// "btc, eth/usdt sol" -> ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
export function parseCoins(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[\s,，;；、]+/)) {
    let symbol = raw.trim().toUpperCase().replace(/[-_/]/g, '')
    if (!symbol) continue
    if (!symbol.endsWith('USDT')) symbol += 'USDT'
    if (!/^[A-Z0-9\p{Script=Han}]{1,20}USDT$/u.test(symbol)) continue
    if (!out.includes(symbol)) out.push(symbol)
    if (out.length >= LIMITS.maxCoins) break
  }
  return out
}

export function getAIConfig(
  config?: StrategyConfig | null
): AIStrategyConfig | null {
  if (!config) return null
  if (config.ai_config) return config.ai_config
  if (config.coin_source && config.indicators && config.risk_control) {
    return {
      coin_source: config.coin_source,
      indicators: config.indicators,
      risk_control: config.risk_control,
      prompt_sections: config.prompt_sections,
      custom_prompt: config.custom_prompt,
    }
  }
  return null
}

export function clampNumber(
  value: unknown,
  range: { min: number; max: number },
  fallback: number
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(range.max, Math.max(range.min, n))
}

export function usesPaidSource(config?: StrategyConfig | null): boolean {
  const ai = getAIConfig(config)
  if (!ai) return false
  const source = ai.coin_source
  return (
    !['static', 'coin_pool', 'hyper_all', 'hyper_main', 'hyper_rank'].includes(
      source.source_type
    ) ||
    source.use_ai500 ||
    source.use_oi_top ||
    source.use_oi_low
  )
}

const paidText = (value?: string) =>
  /claw402|vergex/i.test(value || '') ? '' : value || ''

export function formFromStrategy(strategy: Strategy): FreeForm {
  const ai = getAIConfig(strategy.config)
  const coins = parseCoins((ai?.coin_source.static_coins || []).join(' '))
  const ind = ai?.indicators
  const risk = ai?.risk_control
  const pool =
    ai?.coin_source.source_type === 'coin_pool' && ai.coin_source.coin_pool_id
  const timeframe = timeframeOptions.includes(
    ind?.klines.primary_timeframe || ''
  )
    ? ind!.klines.primary_timeframe
    : '15m'
  const sections = ai?.prompt_sections
  const leverage = clampNumber(
    risk?.btc_eth_max_leverage,
    LIMITS.leverage,
    SAFE_DEFAULTS.leverage
  )
  return {
    name: strategy.name,
    description: strategy.description || '',
    coinSource: pool ? 'pool' : 'static',
    coinPoolID: pool ? ai!.coin_source.coin_pool_id : '',
    poolCoins: pool ? coins : [],
    coinsInput: coins.length > 0 ? coins.join(', ') : DEFAULT_COINS,
    timeframe,
    extraTimeframes: (ind?.klines.selected_timeframes || [])
      .filter((tf) => tf !== timeframe && timeframeOptions.includes(tf))
      .slice(0, LIMITS.maxExtraTimeframes),
    bars: clampNumber(ind?.klines.primary_count, LIMITS.bars, 30),
    leverage,
    altLeverage: clampNumber(
      risk?.altcoin_max_leverage,
      LIMITS.leverage,
      leverage
    ),
    btcEthPositionRatio: clampNumber(
      risk?.btc_eth_max_position_value_ratio,
      LIMITS.positionRatio,
      5
    ),
    altPositionRatio: clampNumber(
      risk?.altcoin_max_position_value_ratio,
      LIMITS.positionRatio,
      5
    ),
    maxPositions: clampNumber(
      risk?.max_positions,
      LIMITS.maxPositions,
      SAFE_DEFAULTS.maxPositions
    ),
    marginUsage: clampNumber(
      risk?.max_margin_usage,
      LIMITS.marginUsage,
      SAFE_DEFAULTS.marginUsage
    ),
    minPositionSize: clampNumber(
      risk?.min_position_size,
      LIMITS.minPositionSize,
      12
    ),
    minConfidence: clampNumber(
      risk?.min_confidence,
      LIMITS.confidence,
      SAFE_DEFAULTS.minConfidence
    ),
    minRiskReward: clampNumber(
      risk?.min_risk_reward_ratio,
      LIMITS.riskReward,
      SAFE_DEFAULTS.minRiskReward
    ),
    // Drop upstream prompts that tell the AI to follow the paid board.
    customPrompt: paidText(ai?.custom_prompt),
    rules: {
      role_definition: paidText(sections?.role_definition),
      trading_frequency: paidText(sections?.trading_frequency),
      entry_standards: paidText(sections?.entry_standards),
      decision_process: paidText(sections?.decision_process),
    },
    indicators: {
      enable_ema: Boolean(ind?.enable_ema),
      enable_macd: Boolean(ind?.enable_macd),
      enable_rsi: Boolean(ind?.enable_rsi),
      enable_atr: Boolean(ind?.enable_atr),
      enable_boll: Boolean(ind?.enable_boll),
      enable_volume: Boolean(ind?.enable_volume),
    },
    enableOI: Boolean(ind?.enable_oi),
    enableFunding: Boolean(ind?.enable_funding_rate),
  }
}

export function configFromForm(
  base: StrategyConfig | null,
  form: FreeForm,
  language: 'zh' | 'en',
  defaultConfig: StrategyConfig | null
): StrategyConfig {
  const ai = getAIConfig(base)
  const defaultAI = getAIConfig(defaultConfig)
  const leverage = form.leverage
  const pool = form.coinSource === 'pool' && Boolean(form.coinPoolID)
  const extra = (form.extraTimeframes || [])
    .filter((tf) => tf !== form.timeframe)
    .slice(0, LIMITS.maxExtraTimeframes)
  const savedSections = ai?.prompt_sections
  const sections = form.rules
    ? {
        role_definition: form.rules.role_definition ?? '',
        trading_frequency: form.rules.trading_frequency ?? '',
        entry_standards: form.rules.entry_standards ?? '',
        decision_process: form.rules.decision_process ?? '',
      }
    : /claw402|vergex/i.test(JSON.stringify(savedSections || {}))
      ? defaultAI?.prompt_sections
      : savedSections || defaultAI?.prompt_sections
  return {
    strategy_type: 'ai_trading',
    language,
    ai_config: {
      coin_source: {
        source_type: pool ? 'coin_pool' : 'static',
        coin_pool_id: pool ? form.coinPoolID : '',
        // For a pool the backend refreshes this snapshot from the pool.
        static_coins: pool
          ? (form.poolCoins || []).slice(0, LIMITS.maxCoins)
          : parseCoins(form.coinsInput),
        excluded_coins: ai?.coin_source.excluded_coins || [],
        use_ai500: false,
        use_oi_top: false,
        use_oi_low: false,
        use_hyper_all: false,
        use_hyper_main: false,
      },
      indicators: {
        ...(ai?.indicators || {}),
        klines: {
          primary_timeframe: form.timeframe,
          primary_count: form.bars,
          longer_timeframe: extra[0] || '',
          longer_count: extra.length ? form.bars : 0,
          enable_multi_timeframe: extra.length > 0,
          selected_timeframes: [form.timeframe, ...extra],
        },
        enable_raw_klines: true,
        ...form.indicators,
        enable_oi: Boolean(form.enableOI),
        enable_funding_rate: Boolean(form.enableFunding),
        // Paid NofxOS datasets stay off.
        nofxos_api_key: '',
        enable_quant_data: false,
        enable_quant_oi: false,
        enable_quant_netflow: false,
        enable_oi_ranking: false,
        enable_netflow_ranking: false,
        enable_price_ranking: false,
      },
      risk_control: {
        max_positions: form.maxPositions,
        btc_eth_max_leverage: leverage,
        altcoin_max_leverage: form.altLeverage ?? leverage,
        btc_eth_max_position_value_ratio:
          form.btcEthPositionRatio ??
          (ai?.risk_control.btc_eth_max_position_value_ratio || 5),
        altcoin_max_position_value_ratio:
          form.altPositionRatio ??
          (ai?.risk_control.altcoin_max_position_value_ratio || 5),
        max_margin_usage: form.marginUsage,
        min_position_size:
          form.minPositionSize ?? (ai?.risk_control.min_position_size || 12),
        min_risk_reward_ratio: form.minRiskReward,
        min_confidence: form.minConfidence,
      },
      custom_prompt: form.customPrompt.trim(),
      prompt_sections: sections,
    },
    grid_config: null,
    publish_config: base?.publish_config,
  }
}

// Default rule text in the UI language, used by "Restore default".
export function defaultRules(
  defaultConfig: StrategyConfig | null
): Record<RuleSection, string> {
  const sections = getAIConfig(defaultConfig)?.prompt_sections
  return {
    role_definition: (sections?.role_definition || '').replace(/^\t/gm, ''),
    trading_frequency: (sections?.trading_frequency || '').replace(/^\t/gm, ''),
    entry_standards: (sections?.entry_standards || '').replace(/^\t/gm, ''),
    decision_process: (sections?.decision_process || '').replace(/^\t/gm, ''),
  }
}
