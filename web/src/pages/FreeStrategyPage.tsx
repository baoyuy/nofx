import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { DeepVoidBackground } from '../components/common/DeepVoidBackground'
import { api } from '../lib/api'
import { confirmToast, notify } from '../lib/notify'
import type { AIStrategyConfig, Strategy, StrategyConfig } from '../types'
import type { CoinPool } from '../lib/api/coinPool'
import { ROUTES } from '../router/paths'

// Free strategy editor: fixed coin list (source_type "static") that works on
// any CEX such as Binance. Never uses paid Claw402 / Vergex / NofxOS data.

const text = (language: string, zh: string, en: string) =>
  language === 'zh' ? zh : en

// Limits mirror store/strategy.go so the backend never has to clamp.
const MAX_COINS = 10
const timeframeOptions = ['5m', '15m', '30m', '1h', '4h']
const barCountOptions = [20, 30]
const leverageOptions = [1, 2, 3, 5, 10, 20]
const maxPositionOptions = [1, 2, 3, 4, 5, 6, 7, 8]
const marginOptions = [0.3, 0.5, 0.8, 1.0]
const confidenceOptions = [60, 70, 75, 80, 85]
const riskRewardOptions = [1.5, 2, 3]

// Indicators computed locally from candles; no paid data needed.
const indicatorOptions = [
  { key: 'enable_ema', zh: 'EMA 均线', en: 'EMA' },
  { key: 'enable_macd', zh: 'MACD', en: 'MACD' },
  { key: 'enable_rsi', zh: 'RSI', en: 'RSI' },
  { key: 'enable_atr', zh: 'ATR 波动率', en: 'ATR' },
  { key: 'enable_boll', zh: '布林带', en: 'Bollinger' },
  { key: 'enable_volume', zh: '成交量', en: 'Volume' },
] as const

type IndicatorKey = (typeof indicatorOptions)[number]['key']

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
  bars: number
  leverage: number
  maxPositions: number
  marginUsage: number
  minConfidence: number
  minRiskReward: number
  customPrompt: string
  indicators: Record<IndicatorKey, boolean>
}

// "btc, eth/usdt sol" -> ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
export function parseCoins(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[\s,，;；、]+/)) {
    let symbol = raw.trim().toUpperCase().replace(/[-_/]/g, '')
    if (!symbol) continue
    if (!symbol.endsWith('USDT')) symbol += 'USDT'
    if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) continue
    if (!out.includes(symbol)) out.push(symbol)
    if (out.length >= MAX_COINS) break
  }
  return out
}

function getAIConfig(config?: StrategyConfig | null): AIStrategyConfig | null {
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

function nearest(
  options: number[],
  value: number | undefined,
  fallback: number
) {
  if (value === undefined || value === null || Number.isNaN(value))
    return fallback
  return options.reduce((best, item) =>
    Math.abs(item - value) < Math.abs(best - value) ? item : best
  )
}

const DEFAULT_COINS = 'BTCUSDT, ETHUSDT, SOLUSDT'

// Conservative starting point for new strategies.
const SAFE_DEFAULTS = {
  leverage: 3,
  maxPositions: 3,
  marginUsage: 0.5,
  minConfidence: 75,
  minRiskReward: 2,
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

function hasClaw402Prompt(ai: AIStrategyConfig | null): boolean {
  const sections = ai?.prompt_sections
  if (!sections) return false
  return Object.values(sections).some((value) =>
    (value || '').toLowerCase().includes('claw402')
  )
}

function formFromStrategy(strategy: Strategy): FreeForm {
  const ai = getAIConfig(strategy.config)
  const coins = parseCoins((ai?.coin_source.static_coins || []).join(' '))
  const ind = ai?.indicators
  const risk = ai?.risk_control
  const customPrompt = ai?.custom_prompt || ''
  const pool =
    ai?.coin_source.source_type === 'coin_pool' && ai.coin_source.coin_pool_id
  return {
    name: strategy.name,
    description: strategy.description || '',
    coinSource: pool ? 'pool' : 'static',
    coinPoolID: pool ? ai!.coin_source.coin_pool_id : '',
    poolCoins: pool ? coins : [],
    coinsInput: coins.length > 0 ? coins.join(', ') : DEFAULT_COINS,
    timeframe: timeframeOptions.includes(ind?.klines.primary_timeframe || '')
      ? ind!.klines.primary_timeframe
      : '15m',
    bars: nearest(barCountOptions, ind?.klines.primary_count, 30),
    leverage: nearest(
      leverageOptions,
      risk?.altcoin_max_leverage || risk?.btc_eth_max_leverage,
      SAFE_DEFAULTS.leverage
    ),
    maxPositions: nearest(
      maxPositionOptions,
      risk?.max_positions,
      SAFE_DEFAULTS.maxPositions
    ),
    marginUsage: nearest(
      marginOptions,
      risk?.max_margin_usage,
      SAFE_DEFAULTS.marginUsage
    ),
    minConfidence: nearest(
      confidenceOptions,
      risk?.min_confidence,
      SAFE_DEFAULTS.minConfidence
    ),
    minRiskReward: nearest(
      riskRewardOptions,
      risk?.min_risk_reward_ratio,
      SAFE_DEFAULTS.minRiskReward
    ),
    // Drop upstream prompts that tell the AI to follow the paid board.
    customPrompt: customPrompt.toLowerCase().includes('claw402')
      ? ''
      : customPrompt,
    indicators: {
      enable_ema: Boolean(ind?.enable_ema),
      enable_macd: Boolean(ind?.enable_macd),
      enable_rsi: Boolean(ind?.enable_rsi),
      enable_atr: Boolean(ind?.enable_atr),
      enable_boll: Boolean(ind?.enable_boll),
      enable_volume: Boolean(ind?.enable_volume),
    },
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
  return {
    strategy_type: 'ai_trading',
    language,
    ai_config: {
      coin_source: {
        source_type: pool ? 'coin_pool' : 'static',
        coin_pool_id: pool ? form.coinPoolID : '',
        // For a pool the backend refreshes this snapshot from the pool.
        static_coins: pool
          ? (form.poolCoins || []).slice(0, MAX_COINS)
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
          longer_timeframe: '',
          longer_count: 0,
          enable_multi_timeframe: false,
          selected_timeframes: [form.timeframe],
        },
        enable_raw_klines: true,
        ...form.indicators,
        enable_oi: false,
        enable_funding_rate: false,
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
        altcoin_max_leverage: leverage,
        btc_eth_max_position_value_ratio:
          ai?.risk_control.btc_eth_max_position_value_ratio || 5,
        altcoin_max_position_value_ratio:
          ai?.risk_control.altcoin_max_position_value_ratio || 5,
        max_margin_usage: form.marginUsage,
        min_position_size: ai?.risk_control.min_position_size || 12,
        min_risk_reward_ratio: form.minRiskReward,
        min_confidence: form.minConfidence,
      },
      custom_prompt: form.customPrompt.trim(),
      prompt_sections: hasClaw402Prompt(ai)
        ? defaultAI?.prompt_sections
        : ai?.prompt_sections || defaultAI?.prompt_sections,
    },
    grid_config: null,
    publish_config: base?.publish_config,
  }
}

const inputClass =
  'w-full rounded-lg border border-[rgba(25,36,52,0.14)] bg-nofx-bg-deeper px-3 py-2 text-sm text-nofx-text outline-hidden focus:border-nofx-gold'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-nofx-text">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-nofx-text-muted">{hint}</span>
      ) : null}
    </label>
  )
}

function SelectField<T extends string | number>({
  label,
  hint,
  value,
  options,
  format,
  onChange,
}: {
  label: string
  hint?: string
  value: T
  options: readonly T[]
  format?: (value: T) => string
  onChange: (value: T) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={String(value)}
        onChange={(event) => {
          const picked = options.find(
            (item) => String(item) === event.target.value
          )
          if (picked !== undefined) onChange(picked)
        }}
        className={inputClass}
      >
        {options.map((item) => (
          <option key={String(item)} value={String(item)}>
            {format ? format(item) : String(item)}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function FreeStrategyPage() {
  const { token } = useAuth()
  const { language } = useLanguage()
  const navigate = useNavigate()
  const lang = (language === 'zh' ? 'zh' : 'en') as 'zh' | 'en'

  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [selected, setSelected] = useState<Strategy | null>(null)
  const [form, setForm] = useState<FreeForm | null>(null)
  const [defaultConfig, setDefaultConfig] = useState<StrategyConfig | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [pools, setPools] = useState<CoinPool[]>([])

  const parsedCoins = useMemo(
    () => (form ? parseCoins(form.coinsInput) : []),
    [form]
  )
  const usingPool = form?.coinSource === 'pool'
  const selectedPool = pools.find((p) => p.id === form?.coinPoolID)

  useEffect(() => {
    if (!token) return
    api
      .getCoinPools()
      .then(setPools)
      .catch(() => setPools([]))
  }, [token])

  const selectStrategy = useCallback((strategy: Strategy | null) => {
    setSelected(strategy)
    setForm(strategy ? formFromStrategy(strategy) : null)
    setHasChanges(false)
  }, [])

  const loadStrategies = useCallback(
    async (preferredId?: string) => {
      if (!token) {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const [list, defaults] = await Promise.all([
          api.getStrategies(),
          api.getDefaultStrategyConfig().catch(() => null),
        ])
        setStrategies(list)
        setDefaultConfig(defaults)
        const next =
          (preferredId ? list.find((item) => item.id === preferredId) : null) ||
          list.find((item) => item.is_active) ||
          list[0] ||
          null
        selectStrategy(next)
      } catch (err) {
        notify.error(
          err instanceof Error
            ? err.message
            : text(language, '加载策略失败', 'Failed to load strategies')
        )
      } finally {
        setLoading(false)
      }
    },
    [token, language, selectStrategy]
  )

  useEffect(() => {
    void loadStrategies()
  }, [loadStrategies])

  const patchForm = (patch: Partial<FreeForm>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev))
    setHasChanges(true)
  }

  const saveStrategy = async (activateAfter = false) => {
    if (!selected || !form) return
    if (usingPool && !form.coinPoolID) {
      notify.error(text(language, '请选择一个币池', 'Choose a coin pool'))
      return
    }
    if (!usingPool && parsedCoins.length === 0) {
      notify.error(
        text(
          language,
          '请至少填写一个币种，例如 BTCUSDT',
          'Add at least one coin, e.g. BTCUSDT'
        )
      )
      return
    }
    setSaving(true)
    try {
      await api.updateStrategy(selected.id, {
        name: form.name.trim() || selected.name,
        description: form.description,
        config: configFromForm(selected.config, form, lang, defaultConfig),
      })
      if (activateAfter) await api.activateStrategy(selected.id)
      notify.success(
        activateAfter
          ? text(language, '策略已保存并激活', 'Strategy saved and activated')
          : text(language, '策略已保存', 'Strategy saved')
      )
      await loadStrategies(selected.id)
    } catch (err) {
      notify.error(
        err instanceof Error
          ? err.message
          : text(language, '保存策略失败', 'Failed to save strategy')
      )
    } finally {
      setSaving(false)
    }
  }

  const createStrategy = async () => {
    setSaving(true)
    try {
      const newForm: FreeForm = {
        name: text(language, '新的固定币种策略', 'New fixed coins strategy'),
        description: '',
        coinsInput: DEFAULT_COINS,
        timeframe: '15m',
        bars: 30,
        ...SAFE_DEFAULTS,
        customPrompt: '',
        indicators: {
          enable_ema: true,
          enable_macd: true,
          enable_rsi: true,
          enable_atr: true,
          enable_boll: false,
          enable_volume: true,
        },
      }
      const created = await api.createStrategy({
        name: newForm.name,
        description: newForm.description,
        config: configFromForm(defaultConfig, newForm, lang, defaultConfig),
      })
      notify.success(text(language, '已创建新策略', 'Strategy created'))
      await loadStrategies(created?.id)
    } catch (err) {
      notify.error(
        err instanceof Error
          ? err.message
          : text(language, '创建策略失败', 'Failed to create strategy')
      )
    } finally {
      setSaving(false)
    }
  }

  const deleteStrategy = async () => {
    if (!selected || selected.is_active) return
    const ok = await confirmToast(
      text(
        language,
        `确定删除策略「${selected.name}」？删除后无法恢复。`,
        `Delete "${selected.name}"? This cannot be undone.`
      ),
      {
        title: text(language, '确认删除', 'Confirm delete'),
        okText: text(language, '删除', 'Delete'),
        cancelText: text(language, '取消', 'Cancel'),
      }
    )
    if (!ok) return
    try {
      await api.deleteStrategy(selected.id)
      notify.success(text(language, '策略已删除', 'Strategy deleted'))
      await loadStrategies()
    } catch (err) {
      notify.error(
        err instanceof Error
          ? err.message
          : text(language, '删除策略失败', 'Failed to delete strategy')
      )
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-nofx-gold" />
      </div>
    )
  }

  const paid = usesPaidSource(selected?.config)

  return (
    <DeepVoidBackground className="nofx-strategy min-h-[calc(100vh-72px)] bg-nofx-bg">
      <div className="border-b border-[rgba(25,36,52,0.14)] px-5 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-nofx-text">
              {text(
                language,
                '策略（免费 · 固定币种）',
                'Strategies (free · fixed coins)'
              )}
            </h1>
            <p className="mt-1 text-sm text-nofx-text-muted">
              {text(
                language,
                '适用于币安等交易所，只用 K 线和本地指标，不调用任何付费数据。',
                'Works with Binance and other exchanges using only candles and local indicators. No paid data.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={createStrategy}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-nofx-gold px-4 py-2 text-sm font-semibold text-nofx-bg hover:bg-nofx-gold-highlight disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {text(language, '新建策略', 'New strategy')}
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-5 md:grid-cols-[240px_1fr]">
        <aside className="space-y-2">
          <div className="px-1 text-xs font-medium uppercase tracking-wide text-nofx-text-muted">
            {text(language, '我的策略', 'My strategies')}
          </div>
          {strategies.length === 0 ? (
            <div className="rounded-lg border border-[rgba(25,36,52,0.14)] p-3 text-sm text-nofx-text-muted">
              {text(
                language,
                '还没有策略，点右上角「新建策略」。',
                'No strategies yet. Click "New strategy".'
              )}
            </div>
          ) : null}
          {strategies.map((strategy) => (
            <button
              key={strategy.id}
              type="button"
              aria-pressed={selected?.id === strategy.id}
              onClick={() => selectStrategy(strategy)}
              className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                selected?.id === strategy.id
                  ? 'border-nofx-gold bg-nofx-gold/10'
                  : 'border-[rgba(25,36,52,0.14)] bg-nofx-bg-lighter hover:border-[rgba(25,36,52,0.24)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium text-nofx-text">
                  {strategy.name}
                </span>
                {strategy.is_active ? (
                  <span className="rounded-sm bg-nofx-success/15 px-1.5 py-0.5 text-[10px] text-nofx-success">
                    {text(language, '使用中', 'Active')}
                  </span>
                ) : null}
              </div>
              {usesPaidSource(strategy.config) ? (
                <div className="mt-1 text-xs text-nofx-danger">
                  {text(
                    language,
                    '付费数据源，需要改',
                    'Paid source, needs update'
                  )}
                </div>
              ) : null}
            </button>
          ))}
        </aside>

        {selected && form ? (
          <main className="space-y-4">
            {paid ? (
              <div
                role="alert"
                className="flex gap-2 rounded-lg border border-nofx-danger/30 bg-nofx-danger/10 p-3 text-sm text-nofx-danger"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {text(
                    language,
                    '这个策略原来用的是付费数据源（Claw402 / Vergex / AI500）。点「保存」后会改成下面的固定币种，之后不再产生费用。',
                    'This strategy used a paid source (Claw402 / Vergex / AI500). Saving switches it to the fixed coins below, with no further charges.'
                  )}
                </span>
              </div>
            ) : null}

            <section className="space-y-4 rounded-lg border border-[rgba(25,36,52,0.14)] bg-nofx-bg-lighter p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={text(language, '策略名称', 'Strategy name')}>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      patchForm({ name: event.target.value })
                    }
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={text(language, '备注（可选）', 'Note (optional)')}
                >
                  <input
                    value={form.description}
                    onChange={(event) =>
                      patchForm({ description: event.target.value })
                    }
                    className={inputClass}
                  />
                </Field>
              </div>

              <div
                className="flex gap-2"
                role="radiogroup"
                aria-label={text(language, '币种来源', 'Coin source')}
              >
                {(
                  [
                    ['static', text(language, '固定币种', 'Fixed coins')],
                    ['pool', text(language, '我的币池', 'My coin pool')],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={(form.coinSource || 'static') === value}
                    onClick={() => patchForm({ coinSource: value })}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${(form.coinSource || 'static') === value ? 'border-nofx-gold bg-nofx-gold/10 font-semibold text-nofx-gold' : 'border-[rgba(25,36,52,0.14)] text-nofx-text'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {usingPool ? (
                <>
                  <Field
                    label={text(language, '币池', 'Coin pool')}
                    hint={text(
                      language,
                      '每轮从币池读取最新币种，按评分取前 10 个。在「币池」页更新币池后，策略下一轮自动生效。',
                      'Each cycle reads the pool fresh and trades its top 10 by score. Updating the pool on the Coin pool page takes effect next cycle.'
                    )}
                  >
                    <select
                      value={form.coinPoolID || ''}
                      onChange={(event) => {
                        const pool = pools.find(
                          (p) => p.id === event.target.value
                        )
                        patchForm({
                          coinPoolID: event.target.value,
                          poolCoins: (pool?.coins || []).map((c) => c.symbol),
                        })
                      }}
                      className={inputClass}
                    >
                      <option value="">
                        {text(language, '选择一个币池…', 'Choose a coin pool…')}
                      </option>
                      {pools.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.coins.length}{' '}
                          {text(language, '个币', 'coins')}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div
                    className="flex flex-wrap items-center gap-2"
                    aria-live="polite"
                  >
                    {selectedPool ? (
                      selectedPool.coins.slice(0, MAX_COINS).map((coin) => (
                        <span
                          key={coin.symbol}
                          className="rounded-md bg-nofx-gold/10 px-2 py-1 text-xs font-medium text-nofx-gold"
                        >
                          {coin.symbol}
                        </span>
                      ))
                    ) : form.coinPoolID ? (
                      <span className="text-xs text-nofx-danger">
                        {text(
                          language,
                          '这个币池已被删除，策略会使用保存时的币种。',
                          'This pool was deleted; the strategy uses the coins saved with it.'
                        )}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => navigate(ROUTES.coinPool)}
                      className="text-xs text-nofx-gold underline"
                    >
                      {pools.length
                        ? text(language, '管理币池', 'Manage coin pools')
                        : text(
                            language,
                            '还没有币池，去币池页筛选',
                            'No pools yet: open the Coin pool page'
                          )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Field
                    label={text(
                      language,
                      '交易币种（最多 10 个）',
                      'Coins to trade (max 10)'
                    )}
                    hint={text(
                      language,
                      '用逗号或空格分隔。可以只写 BTC，会自动补成 BTCUSDT。',
                      'Separate with commas or spaces. "BTC" becomes BTCUSDT automatically.'
                    )}
                  >
                    <input
                      value={form.coinsInput}
                      onChange={(event) =>
                        patchForm({ coinsInput: event.target.value })
                      }
                      placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
                      className={inputClass}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2" aria-live="polite">
                    {parsedCoins.length === 0 ? (
                      <span className="text-xs text-nofx-danger">
                        {text(
                          language,
                          '还没有识别到有效币种',
                          'No valid coins recognized yet'
                        )}
                      </span>
                    ) : (
                      parsedCoins.map((coin) => (
                        <span
                          key={coin}
                          className="rounded-md bg-nofx-gold/10 px-2 py-1 text-xs font-medium text-nofx-gold"
                        >
                          {coin}
                        </span>
                      ))
                    )}
                  </div>
                </>
              )}
            </section>

            <section className="rounded-lg border border-[rgba(25,36,52,0.14)] bg-nofx-bg-lighter p-4">
              <h2 className="mb-3 text-sm font-semibold text-nofx-text">
                {text(language, 'AI 看什么数据', 'What the AI looks at')}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField
                  label={text(language, 'K 线周期', 'Candle timeframe')}
                  hint={text(language, '15m 适合新手', '15m is a good start')}
                  value={form.timeframe}
                  options={timeframeOptions}
                  onChange={(timeframe) => patchForm({ timeframe })}
                />
                <SelectField
                  label={text(language, 'K 线数量', 'Number of candles')}
                  value={form.bars}
                  options={barCountOptions}
                  onChange={(bars) => patchForm({ bars })}
                />
              </div>
              <fieldset className="mt-4">
                <legend className="mb-2 text-sm font-medium text-nofx-text">
                  {text(
                    language,
                    '技术指标（免费，本地计算）',
                    'Indicators (free, computed locally)'
                  )}
                </legend>
                <div className="flex flex-wrap gap-3">
                  {indicatorOptions.map((item) => (
                    <label
                      key={item.key}
                      className="inline-flex items-center gap-2 text-sm text-nofx-text"
                    >
                      <input
                        type="checkbox"
                        checked={form.indicators[item.key]}
                        onChange={(event) =>
                          patchForm({
                            indicators: {
                              ...form.indicators,
                              [item.key]: event.target.checked,
                            },
                          })
                        }
                      />
                      {text(language, item.zh, item.en)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section className="rounded-lg border border-[rgba(25,36,52,0.14)] bg-nofx-bg-lighter p-4">
              <h2 className="mb-1 text-sm font-semibold text-nofx-text">
                {text(language, '风险控制', 'Risk control')}
              </h2>
              <p className="mb-3 text-xs text-nofx-text-muted">
                {text(
                  language,
                  '新手建议：杠杆 3 倍以下，保证金使用率 50% 以下，先用小额资金试跑。',
                  'Beginner tip: leverage 3x or less, margin usage 50% or less, start with a small balance.'
                )}
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <SelectField
                  label={text(language, '杠杆倍数', 'Leverage')}
                  value={form.leverage}
                  options={leverageOptions}
                  format={(value) => `${value}x`}
                  onChange={(leverage) => patchForm({ leverage })}
                />
                <SelectField
                  label={text(language, '最多同时持仓', 'Max open positions')}
                  value={form.maxPositions}
                  options={maxPositionOptions}
                  onChange={(maxPositions) => patchForm({ maxPositions })}
                />
                <SelectField
                  label={text(language, '最多使用保证金', 'Max margin usage')}
                  value={form.marginUsage}
                  options={marginOptions}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onChange={(marginUsage) => patchForm({ marginUsage })}
                />
                <SelectField
                  label={text(language, 'AI 最低把握度', 'Min AI confidence')}
                  hint={text(
                    language,
                    '越高开仓越少',
                    'Higher means fewer trades'
                  )}
                  value={form.minConfidence}
                  options={confidenceOptions}
                  format={(value) => `${value}%`}
                  onChange={(minConfidence) => patchForm({ minConfidence })}
                />
                <SelectField
                  label={text(language, '最低盈亏比', 'Min risk/reward')}
                  value={form.minRiskReward}
                  options={riskRewardOptions}
                  format={(value) => `1 : ${value}`}
                  onChange={(minRiskReward) => patchForm({ minRiskReward })}
                />
              </div>
              {form.leverage >= 10 || form.marginUsage >= 1 ? (
                <p role="alert" className="mt-3 text-xs text-nofx-danger">
                  {text(
                    language,
                    '当前设置风险较高，行情反向时亏损会很快。',
                    'These settings are high risk; losses grow quickly if the market moves against you.'
                  )}
                </p>
              ) : null}
            </section>

            <section className="rounded-lg border border-[rgba(25,36,52,0.14)] bg-nofx-bg-lighter p-4">
              <Field
                label={text(
                  language,
                  '给 AI 的额外要求（可选）',
                  'Extra instructions for the AI (optional)'
                )}
                hint={text(
                  language,
                  '例如：只做多，不做空。',
                  'For example: long only, no shorts.'
                )}
              >
                <textarea
                  value={form.customPrompt}
                  onChange={(event) =>
                    patchForm({ customPrompt: event.target.value })
                  }
                  rows={3}
                  className={inputClass}
                />
              </Field>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveStrategy(true)}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-nofx-success px-4 py-2 text-sm font-semibold text-nofx-bg disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {text(language, '保存并设为使用中', 'Save and use')}
              </button>
              <button
                type="button"
                onClick={() => saveStrategy(false)}
                disabled={saving || (!hasChanges && !paid)}
                className="inline-flex items-center gap-2 rounded-lg bg-nofx-gold px-4 py-2 text-sm font-semibold text-nofx-bg disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {text(language, '仅保存', 'Save only')}
              </button>
              {!selected.is_active ? (
                <button
                  type="button"
                  onClick={deleteStrategy}
                  className="inline-flex items-center gap-2 rounded-lg border border-nofx-danger/25 bg-nofx-danger/10 px-4 py-2 text-sm text-nofx-danger hover:bg-nofx-danger/15"
                >
                  <Trash2 className="h-4 w-4" />
                  {text(language, '删除', 'Delete')}
                </button>
              ) : null}
              {hasChanges ? (
                <span className="text-xs text-nofx-gold">
                  {text(language, '有未保存的更改', 'Unsaved changes')}
                </span>
              ) : null}
            </div>

            <div className="rounded-lg border border-[rgba(25,36,52,0.14)] p-4 text-sm text-nofx-text-muted">
              <div className="mb-2 font-medium text-nofx-text">
                {text(
                  language,
                  '下一步：让它开始交易',
                  'Next: start trading with it'
                )}
              </div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  {text(
                    language,
                    '在「配置 → 连接」里添加币安 API 和 AI 模型（如 DeepSeek）',
                    'Add your Binance API and an AI model (e.g. DeepSeek) under Configuration → Connections'
                  )}
                </li>
                <li>
                  {text(
                    language,
                    '在「Autopilot」里点「创建 Autopilot」，选择这个策略和币安账户',
                    'In Autopilot, click "Create Autopilot" and pick this strategy and your Binance account'
                  )}
                </li>
              </ol>
              <button
                type="button"
                onClick={() => navigate(ROUTES.traders)}
                className="mt-3 rounded-lg border border-[rgba(25,36,52,0.24)] px-3 py-2 text-sm text-nofx-text hover:border-nofx-gold"
              >
                {text(language, '去配置页面', 'Go to Configuration')}
              </button>
            </div>
          </main>
        ) : null}
      </div>
    </DeepVoidBackground>
  )
}
