package copytrade

import (
	"sort"
	"strings"
)

// FeedItem is one action of one followed trader.
type FeedItem struct {
	Event
	PortfolioID string `json:"portfolio_id"`
	Nickname    string `json:"nickname"`
}

// FeedFilter narrows the action feed. Zero values match everything.
type FeedFilter struct {
	PortfolioID string
	Symbol      string
	Action      string // open | add | reduce | close
	MinValue    float64
	Limit       int
}

// Feed merges every followed trader's actions, newest first.
func Feed(snaps []Snapshot, f FeedFilter) []FeedItem {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 200
	}
	sym := strings.ToUpper(f.Symbol)
	var out []FeedItem
	for _, s := range snaps {
		if f.PortfolioID != "" && s.Follow.PortfolioID != f.PortfolioID {
			continue
		}
		for _, e := range s.Events {
			if (sym != "" && e.Symbol != sym) || (f.Action != "" && e.Action != f.Action) || e.Value < f.MinValue {
				continue
			}
			out = append(out, FeedItem{Event: e, PortfolioID: s.Follow.PortfolioID, Nickname: s.Follow.Nickname})
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Time > out[b].Time })
	if len(out) > f.Limit {
		out = out[:f.Limit]
	}
	return out
}

// SideSummary totals one side of a coin across followed traders.
type SideSummary struct {
	Traders int     `json:"traders"`
	Value   float64 `json:"value"`
	// AvgEntry is the size-weighted average entry price.
	AvgEntry float64 `json:"avg_entry"`
}

// SymbolSummary is how followed traders hold one coin.
type SymbolSummary struct {
	Symbol string      `json:"symbol"`
	Long   SideSummary `json:"long"`
	Short  SideSummary `json:"short"`
}

// Holder is one followed trader's position in a coin.
type Holder struct {
	Position
	PortfolioID string `json:"portfolio_id"`
	Nickname    string `json:"nickname"`
}

// Symbols sums positions per coin, most traders first.
func Symbols(snaps []Snapshot) []SymbolSummary {
	by := map[string]*SymbolSummary{}
	qty := map[string]float64{}
	for _, s := range snaps {
		seen := map[string]bool{}
		for _, p := range s.Positions {
			sum := by[p.Symbol]
			if sum == nil {
				sum = &SymbolSummary{Symbol: p.Symbol}
				by[p.Symbol] = sum
			}
			side := &sum.Long
			if p.Side == "short" {
				side = &sum.Short
			}
			// A trader counts once per side even with several positions.
			if k := p.Symbol + p.Side; !seen[k] {
				seen[k] = true
				side.Traders++
			}
			side.Value += p.EntryValue
			qty[p.Symbol+p.Side] += p.Qty
		}
	}
	out := make([]SymbolSummary, 0, len(by))
	for _, s := range by {
		if q := qty[s.Symbol+"long"]; q > 0 {
			s.Long.AvgEntry = s.Long.Value / q
		}
		if q := qty[s.Symbol+"short"]; q > 0 {
			s.Short.AvgEntry = s.Short.Value / q
		}
		out = append(out, *s)
	}
	sort.Slice(out, func(a, b int) bool {
		na, nb := out[a].Long.Traders+out[a].Short.Traders, out[b].Long.Traders+out[b].Short.Traders
		if na != nb {
			return na > nb
		}
		return out[a].Long.Value+out[a].Short.Value > out[b].Long.Value+out[b].Short.Value
	})
	return out
}

// Holders lists followed traders' positions in one coin, largest first.
func Holders(snaps []Snapshot, symbol string) []Holder {
	symbol = strings.ToUpper(symbol)
	var out []Holder
	for _, s := range snaps {
		for _, p := range s.Positions {
			if p.Symbol == symbol {
				out = append(out, Holder{Position: p, PortfolioID: s.Follow.PortfolioID, Nickname: s.Follow.Nickname})
			}
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a].EntryValue > out[b].EntryValue })
	return out
}
