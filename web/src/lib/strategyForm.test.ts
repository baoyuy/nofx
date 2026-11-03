import { describe, expect, it } from 'vitest'
import type { Strategy } from '../types'
import { configFromForm, formFromStrategy, type FreeForm } from './strategyForm'

const form: FreeForm = {
  name: 'horn',
  description: '',
  coinSource: 'horn',
  hornInterval: '15m',
  coinsInput: 'BTCUSDT',
  timeframe: '15m',
  extraTimeframes: [],
  bars: 30,
  leverage: 3,
  maxPositions: 3,
  marginUsage: 0.5,
  minConfidence: 75,
  minRiskReward: 2,
  customPrompt: '',
  indicators: {
    enable_ema: true,
    enable_macd: true,
    enable_rsi: true,
    enable_atr: true,
    enable_boll: false,
    enable_volume: true,
  },
  enableOI: true,
  enableFunding: false,
}

describe('strategy form', () => {
  it('saves the live horn source without a fixed coin list and loads it back', () => {
    const config = configFromForm(null, form, 'zh', null)
    const source = config.ai_config!.coin_source
    expect(source.source_type).toBe('bollinger_horn')
    expect(source.horn_interval).toBe('15m')
    expect(source.static_coins).toEqual([])
    expect(source.coin_pool_id).toBe('')

    const loaded = formFromStrategy({ id: 's', name: 'horn', config } as Strategy)
    expect(loaded.coinSource).toBe('horn')
    expect(loaded.hornInterval).toBe('15m')
  })

  it('defaults an unknown horn interval to 1h', () => {
    const config = configFromForm(null, form, 'zh', null)
    config.ai_config!.coin_source.horn_interval = '2h'
    expect(formFromStrategy({ id: 's', name: 'x', config } as Strategy).hornInterval).toBe('1h')
  })
})
