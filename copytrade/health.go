package copytrade

import (
	"context"
	"math"
	"time"

	"nofx/logger"
)

// Health tells whether a held position still says something about the
// trader's view: a deep loss may just be a trader waiting to break even, and
// an inferred position may have been liquidated without a fill we can tell
// apart (Binance's trade history has no liquidation flag).
type Health struct {
	// ReturnPct is the unrealized result in %: of margin when Margin is known,
	// else of the entry price. Valid only when Priced.
	ReturnPct   float64 `json:"return_pct"`
	PctOfMargin bool    `json:"pct_of_margin"`
	Priced      bool    `json:"priced"`
	// Trapped: the loss passed trappedMarginPct of margin (or trappedMovePct
	// of price when leverage is unknown: the same loss at assumedLeverage).
	Trapped bool `json:"trapped"`
	// Liquidated: inferred position whose loss, with the trader's other
	// inferred losses, reached the trader's whole balance. Excluded from
	// counts and confidence.
	Liquidated bool `json:"liquidated"`
	// Fresh: opened or added to within freshWindow.
	Fresh bool `json:"fresh"`
}

const (
	// At 20x a 1% move is already 20% of margin, so a lower bar flags
	// ordinary noise (40% of positions on the first day at 20%/2%).
	trappedMarginPct = 50.0
	trappedMovePct   = trappedMarginPct / assumedLeverage
	// assumedLeverage turns a price move into a margin loss when leverage is
	// unknown (inferred positions).
	assumedLeverage = 10.0
	freshWindow     = 24 * time.Hour
	freshBoost      = 1.3
	markInterval    = time.Minute
)

// MarksFunc returns mark prices by symbol.
type MarksFunc func(ctx context.Context) (map[string]float64, error)

// marginLossPct is the loss as % of margin (positive = losing).
func (h Health) marginLossPct() float64 {
	if !h.Priced || h.ReturnPct >= 0 {
		return 0
	}
	if h.PctOfMargin {
		return -h.ReturnPct
	}
	return -h.ReturnPct * assumedLeverage
}

// healthFactor scales a position's vote: a losing position counts less
// (0.55 at 50% of margin lost, 0.1 at 100%), a liquidated one not at all,
// and a fresh open or add counts more. An add that deepens a loss is
// doubling down, not a fresh view, so it gets no boost.
func healthFactor(p Position) float64 {
	if p.Liquidated {
		return 0
	}
	f := 1 - 0.9*math.Min(100, p.marginLossPct())/100
	if p.Fresh && !p.Trapped {
		f *= freshBoost
	}
	return f
}

// firstEntryMarginLoss is the loss as % of margin measured from the entry
// furthest against the position, so averaging down does not hide how deep it
// actually is. Zero when it is not losing or nothing is priced.
func (p Position) firstEntryMarginLoss() float64 {
	if p.FirstEntry <= 0 || p.MarkPrice <= 0 || p.EntryPrice <= 0 {
		return 0
	}
	dir := 1.0
	if p.Side == "short" {
		dir = -1
	}
	worst := p.EntryPrice
	switch {
	case dir > 0 && p.FirstEntry > worst:
		worst = p.FirstEntry
	case dir < 0 && p.FirstEntry < worst:
		worst = p.FirstEntry
	}
	move := -dir * (p.MarkPrice - worst) / worst * 100 // positive = losing
	if move <= 0 {
		return 0
	}
	if p.Leverage > 0 {
		return move * p.Leverage
	}
	return move * assumedLeverage
}

// assessHealth prices positions at marks and flags trapped, fresh and likely
// liquidated ones. It returns a new slice.
func assessHealth(positions []Position, marks map[string]float64, balance float64, now time.Time) []Position {
	out := make([]Position, len(positions))
	var inferredLoss float64
	for i, p := range positions {
		p.Health = Health{}
		dir := 1.0
		if p.Side == "short" {
			dir = -1
		}
		if p.Source != "public" {
			if m := marks[p.Symbol]; m > 0 {
				p.MarkPrice = m
				p.UnrealizedPnL = dir * (m - p.EntryPrice) * p.Qty
			} else {
				p.MarkPrice, p.UnrealizedPnL = 0, 0
			}
		}
		if p.MarkPrice > 0 && p.EntryPrice > 0 {
			p.Priced = true
			if p.Margin > 0 {
				p.ReturnPct, p.PctOfMargin = p.UnrealizedPnL/p.Margin*100, true
			} else {
				p.ReturnPct = dir * (p.MarkPrice - p.EntryPrice) / p.EntryPrice * 100
			}
		}
		if p.Priced {
			if p.PctOfMargin {
				p.Trapped = p.ReturnPct <= -trappedMarginPct
			} else {
				p.Trapped = p.ReturnPct <= -trappedMovePct
			}
			// A trader who averaged down sits on a bigger loss than the
			// average entry shows: check the loss from the first entry too.
			if !p.Trapped && p.firstEntryMarginLoss() >= trappedMarginPct {
				p.Trapped = true
			}
		}
		last := p.LastAddAt
		if last == 0 {
			last = p.OpenedAt
		}
		p.Fresh = last > 0 && now.Sub(time.UnixMilli(last)) < freshWindow
		if p.Source != "public" && p.UnrealizedPnL < 0 {
			inferredLoss -= p.UnrealizedPnL
		}
		out[i] = p
	}
	// A loss that ate the whole balance would have liquidated a cross-margin
	// account. Isolated positions can go earlier; we cannot see those.
	if balance > 0 && inferredLoss >= balance {
		for i := range out {
			if out[i].Source != "public" && out[i].UnrealizedPnL < 0 {
				out[i].Liquidated, out[i].Trapped = true, false
			}
		}
	}
	return out
}

// markLoop keeps mark prices for the held coins, once a minute while any
// followed trader holds something.
func (m *Monitor) markLoop(ctx context.Context) {
	if m.Marks == nil {
		return
	}
	t := time.NewTicker(markInterval)
	defer t.Stop()
	for {
		if m.holdsAny() {
			marks, err := m.Marks(ctx)
			if err != nil {
				logger.Warnf("copy-trade: mark prices: %v", err)
			} else {
				m.markMu.Lock()
				m.marks = marks
				m.markMu.Unlock()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (m *Monitor) holdsAny() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, s := range m.snaps {
		if len(s.Positions) > 0 {
			return true
		}
	}
	return false
}

func (m *Monitor) currentMarks() map[string]float64 {
	m.markMu.RLock()
	defer m.markMu.RUnlock()
	return m.marks
}
