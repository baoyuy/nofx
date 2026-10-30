// Package coinpool screens Binance USDT-M perpetuals for the coin pool page.
// Screeners only read public market data and never trade.
package coinpool

import "math"

const (
	bollPeriod  = 20
	bollWidth   = 2.0
	squeezeLook = 40 // bars searched for the squeeze before the expansion
	historyLook = 120
	slopeBars   = 5
)

// HornResult is the Bollinger "horn" (squeeze then expansion) reading of one
// market. Stage: opening (bands still widening), mature (wide, widening has
// stalled), closing (bands contracting again), none (no expansion).
type HornResult struct {
	Match         bool    `json:"match"`
	Direction     string  `json:"direction"` // long | short | neutral
	Score         float64 `json:"score"`     // 0-100
	Stage         string  `json:"stage"`
	Expansion     float64 `json:"expansion"`      // current bandwidth / squeeze bandwidth
	SqueezePctile float64 `json:"squeeze_pctile"` // squeeze bandwidth rank in history, 0 = tightest
	PercentB      float64 `json:"percent_b"`      // close position inside the bands
	BarsSince     int     `json:"bars_since"`     // bars since the squeeze low
	Bandwidth     float64 `json:"bandwidth"`
}

type bands struct{ mid, upper, lower, width []float64 }

func bollinger(closes []float64) bands {
	n := len(closes)
	b := bands{make([]float64, n), make([]float64, n), make([]float64, n), make([]float64, n)}
	for i := bollPeriod - 1; i < n; i++ {
		var sum, sq float64
		for _, v := range closes[i-bollPeriod+1 : i+1] {
			sum += v
		}
		mean := sum / bollPeriod
		for _, v := range closes[i-bollPeriod+1 : i+1] {
			sq += (v - mean) * (v - mean)
		}
		sd := math.Sqrt(sq / bollPeriod)
		b.mid[i], b.upper[i], b.lower[i] = mean, mean+bollWidth*sd, mean-bollWidth*sd
		if mean > 0 {
			b.width[i] = (b.upper[i] - b.lower[i]) / mean
		}
	}
	return b
}

// AnalyzeHorn reads closed candles, oldest first. It needs at least
// bollPeriod+squeezeLook bars.
func AnalyzeHorn(closes []float64) HornResult {
	out := HornResult{Direction: "neutral", Stage: "none"}
	n := len(closes)
	if n < bollPeriod+squeezeLook {
		return out
	}
	b := bollinger(closes)
	last := n - 1
	first := bollPeriod - 1

	// Squeeze: the tightest bandwidth in the recent window, at least 3 bars ago.
	lo := last - squeezeLook
	if lo < first {
		lo = first
	}
	sqIdx := lo
	for i := lo; i <= last-3; i++ {
		if b.width[i] < b.width[sqIdx] {
			sqIdx = i
		}
	}
	squeeze := b.width[sqIdx]
	if squeeze <= 0 {
		return out
	}
	out.Bandwidth = b.width[last]
	out.Expansion = b.width[last] / squeeze
	out.BarsSince = last - sqIdx

	// How tight was the squeeze compared with this market's own history?
	hist := last - historyLook
	if hist < first {
		hist = first
	}
	below, total := 0, 0
	for i := hist; i <= last; i++ {
		total++
		if b.width[i] < squeeze {
			below++
		}
	}
	out.SqueezePctile = float64(below) / float64(total)

	if span := b.upper[last] - b.lower[last]; span > 0 {
		out.PercentB = (closes[last] - b.lower[last]) / span
	}
	// The horn: upper band rising while the lower band falls.
	ref := last - slopeBars
	upperUp := b.upper[last] > b.upper[ref]
	lowerDown := b.lower[last] < b.lower[ref]
	diverging := upperUp && lowerDown
	peak := b.width[sqIdx]
	for i := sqIdx; i <= last; i++ {
		if b.width[i] > peak {
			peak = b.width[i]
		}
	}
	widening := b.width[last] >= b.width[last-1] && b.width[last] >= peak*0.98

	switch {
	case out.Expansion < 1.4:
		out.Stage = "none"
	case diverging && widening:
		out.Stage = "opening"
	case b.width[last] >= peak*0.85:
		out.Stage = "mature"
	default:
		out.Stage = "closing"
	}

	midUp := b.mid[last] > b.mid[ref]
	switch {
	case out.PercentB >= 0.6 && midUp:
		out.Direction = "long"
	case out.PercentB <= 0.4 && !midUp:
		out.Direction = "short"
	}

	out.Match = out.Expansion >= 1.6 && diverging && out.Stage != "closing" && out.Direction != "neutral"
	out.Score = hornScore(out, diverging)
	return out
}

// hornScore: expansion strength 35, squeeze tightness 20, band divergence
// 15, direction clarity 20, freshness 10. Closing bands score at most half.
func hornScore(r HornResult, diverging bool) float64 {
	if r.Stage == "none" {
		return 0
	}
	score := 35 * clamp((r.Expansion-1)/2) // full at 3x
	score += 20 * (1 - clamp(r.SqueezePctile/0.5))
	if diverging {
		score += 15
	}
	if r.Direction == "long" {
		score += 20 * clamp((r.PercentB-0.5)/0.5)
	} else if r.Direction == "short" {
		score += 20 * clamp((0.5-r.PercentB)/0.5)
	}
	score += 10 * (1 - clamp(float64(r.BarsSince-3)/20))
	if r.Stage == "closing" {
		score *= 0.5
	}
	return math.Round(score)
}

func clamp(v float64) float64 { return math.Max(0, math.Min(1, v)) }
