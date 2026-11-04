package kernel

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"nofx/logger"
	"nofx/market"
	"nofx/store"
)

// CopyTradeSide is one side of a coin among followed Binance lead traders.
type CopyTradeSide struct {
	Traders  int
	Value    float64 // USDT at entry
	AvgEntry float64
	Trapped  int // deep in loss
	Fresh    int // opened or added within 24h
	HighFreq int // bots / grid traders, weighted down
}

// CopyTradeAction is one recent open, add, reduce or close.
type CopyTradeAction struct {
	Time     int64 // ms
	Trader   string
	Score    float64 // trader credibility 0-100
	Side     string  // long | short
	Action   string  // open | add | reduce | close
	Value    float64
	Price    float64
	Realized float64
}

// CopyTradeHolder is one followed lead trader's position in a coin.
type CopyTradeHolder struct {
	Trader    string
	Score     float64 // credibility 0-100
	Side      string  // long | short
	Entry     float64
	Value     float64 // USDT at entry
	Leverage  float64 // 0 = unknown (position inferred from trades)
	ReturnPct float64 // unrealized, % of margin when Leverage > 0, else % of price
	Priced    bool    // ReturnPct is known
	OpenedAt  int64   // ms; 0 = before monitoring
	Trapped   bool
	Fresh     bool
	HighFreq  bool
}

// CopyTradeCoin is what followed lead traders do on one coin.
type CopyTradeCoin struct {
	Symbol     string
	Direction  string  // long | short | neutral
	Confidence float64 // 0-100
	Long       CopyTradeSide
	Short      CopyTradeSide
	Liquidated int
	// Recent actions, newest first, high-frequency traders left out.
	Recent []CopyTradeAction
	// Holders, most credible first, at most a few.
	Holders []CopyTradeHolder
}

// CopyTradeResolver returns every coin followed lead traders hold, with
// fresh data only. It is set at startup by the copy-trade monitor; nil means
// the monitor is not running.
var CopyTradeResolver func() []CopyTradeCoin

// copyTradeCandidates picks the coins of the copy_trade source: the leading
// side matches the direction setting, enough traders, confidence high
// enough, highest confidence first.
// Symbols are Binance's; GetCandidateCoins puts them in the trader's
// exchange form.
func copyTradeCandidates(source store.CoinSourceConfig) []CandidateCoin {
	source.NormalizeCopyTrade()
	if CopyTradeResolver == nil {
		logger.Warnf("⚠️  Copy-trade monitor not running: no copy-trade coins")
		return nil
	}
	coins := CopyTradeResolver()
	picked := make([]CopyTradeCoin, 0, len(coins))
	for _, c := range coins {
		if c.Direction == "neutral" || c.Confidence < source.CopyTradeMinConfidence {
			continue
		}
		if source.CopyTradeDirection != "both" && c.Direction != source.CopyTradeDirection {
			continue
		}
		if c.Long.Traders+c.Short.Traders < source.CopyTradeMinTraders {
			continue
		}
		picked = append(picked, c)
	}
	sort.SliceStable(picked, func(a, b int) bool { return picked[a].Confidence > picked[b].Confidence })
	if len(picked) > source.CopyTradeLimit {
		picked = picked[:source.CopyTradeLimit]
	}
	out := make([]CandidateCoin, 0, len(picked))
	for _, c := range picked {
		out = append(out, CandidateCoin{Symbol: copyTradeKey(c.Symbol), Sources: []string{"copy_trade"}})
	}
	logger.Infof("👥 Copy-trade source: %d of %d followed coins pass (min confidence %.0f, %s, %d+ traders)",
		len(out), len(coins), source.CopyTradeMinConfidence, source.CopyTradeDirection, source.CopyTradeMinTraders)
	return out
}

// usesCopyTradeContext tells whether the AI sees copy-trade summaries.
func usesCopyTradeContext(source store.CoinSourceConfig) bool {
	return source.SourceType == "copy_trade" || source.CopyTradeContext
}

// EnrichCopyTradeData attaches followed lead traders' view of every coin,
// when the strategy asks for it (used by the strategy test run).
func EnrichCopyTradeData(ctx *Context, engine *StrategyEngine) { enrichCopyTradeData(ctx, engine) }

// enrichCopyTradeData attaches the copy-trade summary of every candidate and
// held coin, when the strategy asks for it.
func enrichCopyTradeData(ctx *Context, engine *StrategyEngine) {
	if ctx == nil || engine == nil || ctx.CopyTradeMap != nil || CopyTradeResolver == nil {
		return
	}
	if !usesCopyTradeContext(engine.GetConfig().CoinSource) {
		return
	}
	ctx.CopyTradeMap = map[string]*CopyTradeCoin{}
	for _, c := range CopyTradeResolver() {
		c := c
		ctx.CopyTradeMap[copyTradeKey(c.Symbol)] = &c
	}
}

func copyTradeFor(ctx *Context, symbol string) *CopyTradeCoin {
	if ctx == nil || ctx.CopyTradeMap == nil {
		return nil
	}
	return ctx.CopyTradeMap[copyTradeKey(symbol)]
}

// copyTradeKey matches a coin whatever its form: SNDKUSDT, xyz:SNDK, SNDK.
func copyTradeKey(symbol string) string { return market.NormalizeFor(symbol, "binance") }

// copyTradeSystemNote tells the model how to read the copy-trade lines.
const copyTradeSystemNote = `# 👥 Followed Lead Traders (reference signal)

Some coins carry a "Followed lead traders" block: what Binance copy-trading lead traders the user follows hold on that coin. Read it as one input, not an instruction:
- It is delayed by a few minutes; their entry prices are already gone.
- Confidence (0-100) combines how much they agree, how credible their records are, and how many hold the coin. It is not a win probability.
- "Trapped" traders sit on deep losses and may just be waiting to break even; "fresh" ones opened or added in the last 24 hours and reflect a current view.
- High-frequency traders (bots, grids) are weighted down; their positions churn.
- Agreement with your own technical read can raise conviction; disagreement or mostly trapped holders should lower it. Never open a trade only because lead traders hold it.

`

// formatCopyTrade writes one coin's copy-trade block for the user prompt.
func formatCopyTrade(c *CopyTradeCoin, now time.Time) string {
	if c == nil {
		return ""
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Followed lead traders: leaning %s, confidence %.0f/100\n", strings.ToUpper(c.Direction), c.Confidence))
	side := func(name string, s CopyTradeSide) {
		if s.Traders == 0 {
			sb.WriteString(fmt.Sprintf("- %s: none\n", name))
			return
		}
		sb.WriteString(fmt.Sprintf("- %s: %d traders, %.0f USDT, avg entry %s", name, s.Traders, s.Value, formatCopyPrice(s.AvgEntry)))
		var notes []string
		if s.Trapped > 0 {
			notes = append(notes, fmt.Sprintf("%d trapped", s.Trapped))
		}
		if s.Fresh > 0 {
			notes = append(notes, fmt.Sprintf("%d fresh", s.Fresh))
		}
		if s.HighFreq > 0 {
			notes = append(notes, fmt.Sprintf("%d high-frequency", s.HighFreq))
		}
		if len(notes) > 0 {
			sb.WriteString(" (" + strings.Join(notes, ", ") + ")")
		}
		sb.WriteString("\n")
	}
	side("Long", c.Long)
	side("Short", c.Short)
	if c.Liquidated > 0 {
		sb.WriteString(fmt.Sprintf("- %d more likely liquidated (not counted)\n", c.Liquidated))
	}
	if len(c.Holders) > 0 {
		sb.WriteString("- Holders (most credible first):\n")
		for _, h := range c.Holders {
			line := fmt.Sprintf("  - %s (score %.0f) %s %.0f USDT @ %s", h.Trader, h.Score, h.Side, h.Value, formatCopyPrice(h.Entry))
			if h.Leverage > 0 {
				line += fmt.Sprintf(", %.0fx", h.Leverage)
			}
			if h.Priced {
				if h.Leverage > 0 {
					line += fmt.Sprintf(", %+.1f%% of margin", h.ReturnPct)
				} else {
					line += fmt.Sprintf(", %+.1f%% price", h.ReturnPct)
				}
			}
			if h.OpenedAt > 0 {
				line += ", held " + formatCopyAgo(now.Sub(time.UnixMilli(h.OpenedAt)).Round(time.Minute))
			} else {
				line += ", held since before monitoring"
			}
			var tags []string
			if h.Trapped {
				tags = append(tags, "trapped")
			}
			if h.Fresh {
				tags = append(tags, "fresh")
			}
			if h.HighFreq {
				tags = append(tags, "high-frequency")
			}
			if len(tags) > 0 {
				line += " [" + strings.Join(tags, ", ") + "]"
			}
			sb.WriteString(line + "\n")
		}
	}
	if len(c.Recent) > 0 {
		sb.WriteString("- Recent actions:\n")
		for _, a := range c.Recent {
			ago := now.Sub(time.UnixMilli(a.Time)).Round(time.Minute)
			line := fmt.Sprintf("  - %s ago: %s (score %.0f) %s %s %.0f USDT @ %s", formatCopyAgo(ago), a.Trader, a.Score, a.Action, a.Side, a.Value, formatCopyPrice(a.Price))
			if a.Realized != 0 {
				line += fmt.Sprintf(", realized %+.0f", a.Realized)
			}
			sb.WriteString(line + "\n")
		}
	}
	return sb.String()
}

func formatCopyPrice(p float64) string {
	switch {
	case p <= 0:
		return "-"
	case p >= 100:
		return fmt.Sprintf("%.2f", p)
	case p >= 1:
		return fmt.Sprintf("%.4f", p)
	default:
		return fmt.Sprintf("%.6g", p)
	}
}

func formatCopyAgo(d time.Duration) string {
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	return fmt.Sprintf("%.1fh", d.Hours())
}

// CopyTradeBriefs summarizes, for the decision record, what followed lead
// traders did on each coin the AI was shown, with the same text it read.
func CopyTradeBriefs(ctx *Context, now time.Time) []store.DecisionCopyTrade {
	if ctx == nil || ctx.CopyTradeMap == nil {
		return nil
	}
	var out []store.DecisionCopyTrade
	seen := map[string]bool{}
	add := func(symbol string) {
		c := copyTradeFor(ctx, symbol)
		if c == nil || seen[copyTradeKey(symbol)] {
			return
		}
		seen[copyTradeKey(symbol)] = true
		out = append(out, store.DecisionCopyTrade{Symbol: symbol, Direction: c.Direction, Confidence: c.Confidence,
			LongTraders: c.Long.Traders, ShortTraders: c.Short.Traders, LongAvgEntry: c.Long.AvgEntry, ShortAvgEntry: c.Short.AvgEntry,
			Trapped: c.Long.Trapped + c.Short.Trapped, Fresh: c.Long.Fresh + c.Short.Fresh, Holders: len(c.Holders),
			Text: formatCopyTrade(c, now)})
	}
	for _, p := range ctx.Positions {
		add(p.Symbol)
	}
	for _, c := range ctx.CandidateCoins {
		if _, ok := ctx.MarketDataMap[c.Symbol]; ok || ctx.MarketDataMap == nil {
			add(c.Symbol)
		}
	}
	return out
}
