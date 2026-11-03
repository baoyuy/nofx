package copytrade

import (
	"math"
	"sort"
	"strings"
)

// FeedItem is one action of one followed trader.
type FeedItem struct {
	Event
	PortfolioID string `json:"portfolio_id"`
	Nickname    string `json:"nickname"`
	AvatarURL   string `json:"avatar_url"`
}

// FeedFilter narrows the action feed. Zero values match everything.
type FeedFilter struct {
	PortfolioID string
	Symbol      string
	Action      string // open | add | reduce | close
	MinValue    float64
	Limit       int
	// Offset skips that many newest matches (for paging).
	Offset int
}

// Feed merges every followed trader's actions, newest first.
func Feed(snaps []Snapshot, f FeedFilter) []FeedItem {
	items, _ := FeedPage(snaps, f)
	return items
}

// FeedPage returns one page of the merged actions and how many match in all.
func FeedPage(snaps []Snapshot, f FeedFilter) ([]FeedItem, int) {
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
			out = append(out, FeedItem{Event: e, PortfolioID: s.Follow.PortfolioID, Nickname: s.Follow.Nickname,
				AvatarURL: s.Follow.AvatarURL})
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Time > out[b].Time })
	total := len(out)
	start := min(max(0, f.Offset), total)
	return out[start:min(start+f.Limit, total)], total
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
	Symbol     string      `json:"symbol"`
	Long       SideSummary `json:"long"`
	Short      SideSummary `json:"short"`
	Confidence Confidence  `json:"confidence"`
}

// Holder is one followed trader's position in a coin, with the trader's
// 30-day results.
type Holder struct {
	Position
	PortfolioID string  `json:"portfolio_id"`
	Nickname    string  `json:"nickname"`
	AvatarURL   string  `json:"avatar_url"`
	ROI30       float64 `json:"roi_30d"`
	PnL30       float64 `json:"pnl_30d"`
	WinRate30   float64 `json:"win_rate_30d"`
	Score       float64 `json:"score"`
}

// Symbols sums positions per coin with each coin's direction confidence,
// most traders first. Snapshots must carry their Score.
func Symbols(snaps []Snapshot) []SymbolSummary {
	by := map[string]*SymbolSummary{}
	qty := map[string]float64{}
	// One vote per trader and side: value-weighted stake times trader score.
	votes := map[string]map[string]*vote{}
	for _, s := range snaps {
		seen := map[string]bool{}
		for _, p := range s.Positions {
			if votes[p.Symbol] == nil {
				votes[p.Symbol] = map[string]*vote{}
			}
			vk := s.Follow.PortfolioID + p.Side
			v := votes[p.Symbol][vk]
			if v == nil {
				v = &vote{trader: s.Follow.PortfolioID, side: p.Side, score: s.Score.Score}
				votes[p.Symbol][vk] = v
			}
			v.weight += p.EntryValue
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
	balance := map[string]float64{}
	for _, s := range snaps {
		balance[s.Follow.PortfolioID] = s.Follow.MarginBalance
	}
	out := make([]SymbolSummary, 0, len(by))
	for _, s := range by {
		var list []vote
		for _, v := range votes[s.Symbol] {
			list = append(list, vote{trader: v.trader, side: v.side, score: v.score,
				weight: math.Max(1, v.score) * stakeFactor(v.weight, balance[v.trader])})
		}
		s.Confidence = confidence(list)
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
				f := s.Follow
				out = append(out, Holder{Position: p, PortfolioID: f.PortfolioID, Nickname: f.Nickname, AvatarURL: f.AvatarURL,
					ROI30: f.ROI, PnL30: f.PnL, WinRate30: f.WinRate, Score: s.Score.Score})
			}
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a].EntryValue > out[b].EntryValue })
	return out
}
