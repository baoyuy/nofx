import { describe, expect, it } from 'vitest'
import { ruleLabel, rulesLabel } from './format'

describe('auto-follow rule labels', () => {
  it('labels every drop rule the backend sends', () => {
    for (const code of [
      'closed',
      'private',
      'martingale',
      'roi_negative',
      'mdd_high',
      'balance_low',
      'stale_trapped',
      'inactive',
      'over_target',
      'manual',
    ]) {
      expect(ruleLabel('zh', code)).not.toBe(code)
      expect(ruleLabel('en', code)).not.toBe(code)
    }
  })

  it('joins several rules and reads the pick reason', () => {
    expect(rulesLabel('zh', 'martingale,roi_negative')).toBe(
      '摊平型、30 天收益为负'
    )
    expect(rulesLabel('en', 'roi90=120,mdd90=15')).toBe(
      '90-day ROI 120%, drawdown 15%'
    )
  })
})
