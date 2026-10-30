package kernel

import (
	"nofx/logger"
	"nofx/market"
	"nofx/store"
)

// CoinPoolResolver returns the current symbols of a saved coin pool. It is
// set at startup; the engine has no database access of its own.
var CoinPoolResolver func(poolID string) ([]string, error)

// coinPoolCandidates reads the pool fresh each cycle, so edits on the coin
// pool page reach running strategies. A missing pool falls back to the
// snapshot saved with the strategy.
func coinPoolCandidates(source store.CoinSourceConfig) []CandidateCoin {
	symbols := source.StaticCoins
	origin := "coin_pool_snapshot"
	if CoinPoolResolver != nil && source.CoinPoolID != "" {
		if live, err := CoinPoolResolver(source.CoinPoolID); err == nil && len(live) > 0 {
			symbols, origin = live, "coin_pool"
		} else {
			logger.Warnf("⚠️  Coin pool %s unavailable (%v), using the saved snapshot", source.CoinPoolID, err)
		}
	}
	if len(symbols) > store.MaxCandidateCoins {
		symbols = symbols[:store.MaxCandidateCoins]
	}
	out := make([]CandidateCoin, 0, len(symbols))
	for _, symbol := range symbols {
		out = append(out, CandidateCoin{Symbol: market.Normalize(symbol), Sources: []string{origin}})
	}
	return out
}
