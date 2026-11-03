package copytrade

import (
	"math"
	"testing"
)

func fill(t int64, side, ps string, qty, price, pnl float64) Fill {
	return Fill{Time: t, Symbol: "BTCUSDT", Side: side, PositionSide: ps, Qty: qty, Price: price, RealizedPnL: pnl}
}

func approx(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func TestReplayHedgeOpenAddReduceClose(t *testing.T) {
	positions, events := Replay([]Fill{
		fill(1000, "BUY", "LONG", 1, 100, 0),
		fill(60000, "BUY", "LONG", 0.5, 112, 0), // one order reported as two fills
		fill(60100, "BUY", "LONG", 0.5, 112, 0),
		fill(90000, "SELL", "LONG", 1, 120, 16),
	})
	if len(positions) != 1 {
		t.Fatalf("positions = %+v", positions)
	}
	p := positions[0]
	// Entry 106 (1 @100 + 1 @112); half closed keeps the average.
	if p.Side != "long" || !approx(p.Qty, 1) || !approx(p.EntryPrice, 106) || p.OpenedAt != 1000 || p.Source != "inferred" {
		t.Fatalf("position = %+v", p)
	}
	want := []string{"open", "add", "reduce"}
	if len(events) != len(want) {
		t.Fatalf("events = %+v", events)
	}
	for i, a := range want {
		if events[i].Action != a {
			t.Fatalf("event %d = %s, want %s (%+v)", i, events[i].Action, a, events)
		}
	}
	if !approx(events[1].Qty, 1) || !approx(events[1].Price, 112) {
		t.Fatalf("split fills must merge into one add: %+v", events[1])
	}

	_, events = Replay(append([]Fill{fill(95000, "SELL", "LONG", 2, 125, 38)}, fill(1000, "BUY", "LONG", 2, 106, 0)))
	if events[len(events)-1].Action != "close" || events[len(events)-1].PositionQty != 0 {
		t.Fatalf("selling all must close: %+v", events)
	}
}

func TestReplayOneWayFlipAndUntrackedClose(t *testing.T) {
	// Long 1 @100, then sell 3 @110: closing 1 realizes +10, the other 2 open a short.
	positions, events := Replay([]Fill{
		fill(1000, "BUY", "BOTH", 1, 100, 0),
		fill(5000, "SELL", "BOTH", 3, 110, 10),
	})
	if len(positions) != 1 || positions[0].Side != "short" || !approx(positions[0].Qty, 2) || !approx(positions[0].EntryPrice, 110) {
		t.Fatalf("flip must leave a 2 short @110: %+v", positions)
	}
	if len(events) != 3 || events[1].Action != "close" || events[2].Action != "open" || events[2].Side != "short" {
		t.Fatalf("events = %+v", events)
	}

	// A sell with realized PnL and no tracked position closes something opened
	// before monitoring: reported, but no short is invented.
	positions, events = Replay([]Fill{fill(1000, "SELL", "BOTH", 2, 120, 40)})
	if len(positions) != 0 || len(events) != 1 || !events[0].Untracked || events[0].Side != "long" {
		t.Fatalf("untracked close: %+v %+v", positions, events)
	}

	// Selling more than tracked with PnL that does not fit a flip means the
	// long was larger than what monitoring saw: close, do not open a short.
	positions, _ = Replay([]Fill{
		fill(1000, "BUY", "BOTH", 1, 100, 0),
		fill(5000, "SELL", "BOTH", 3, 110, 30),
	})
	if len(positions) != 0 {
		t.Fatalf("over-close must not invent a short: %+v", positions)
	}
}

func TestReplayHedgeShortAndUnknownReduce(t *testing.T) {
	positions, _ := Replay([]Fill{
		fill(1000, "SELL", "SHORT", 2, 100, 0),
		fill(2000, "BUY", "SHORT", 3, 90, 25), // closes more than tracked
		fill(3000, "BUY", "SHORT", 1, 95, 5),  // reduces a short opened before monitoring
	})
	if len(positions) != 0 {
		t.Fatalf("hedge bucket must not flip: %+v", positions)
	}
}

func TestLivePositionsUseRebuiltOpenTime(t *testing.T) {
	live := []LivePosition{{Symbol: "ETHUSDT", PositionSide: "BOTH", PositionAmount: -4, EntryPrice: 2292.5, MarkPrice: 2253, Leverage: 20}}
	out := LivePositions(live, []Position{{Symbol: "ETHUSDT", Side: "short", OpenedAt: 777}})
	p := out[0]
	if p.Side != "short" || p.Qty != 4 || !approx(p.EntryValue, 9170) || !approx(p.Margin, 458.5) || p.OpenedAt != 777 || p.Source != "public" {
		t.Fatalf("live = %+v", p)
	}
}

func TestSymbolsAveragesEntryBySize(t *testing.T) {
	snaps := []Snapshot{
		{Positions: []Position{{Symbol: "BTCUSDT", Side: "long", Qty: 1, EntryPrice: 100, EntryValue: 100}}},
		{Positions: []Position{{Symbol: "BTCUSDT", Side: "long", Qty: 3, EntryPrice: 120, EntryValue: 360}}},
		{Positions: []Position{{Symbol: "BTCUSDT", Side: "short", Qty: 1, EntryPrice: 130, EntryValue: 130}}},
	}
	s := Symbols(snaps)[0]
	if s.Long.Traders != 2 || !approx(s.Long.Value, 460) || !approx(s.Long.AvgEntry, 115) || s.Short.Traders != 1 {
		t.Fatalf("summary = %+v", s)
	}
}

func TestFeedPages(t *testing.T) {
	var events []Event
	for i := 0; i < 25; i++ {
		events = append(events, Event{Time: int64(100 - i), Symbol: "BTCUSDT", Side: "long", Action: "open", Value: 10})
	}
	snaps := []Snapshot{{Events: events}}
	page, total := FeedPage(snaps, FeedFilter{Limit: 10, Offset: 20})
	if total != 25 || len(page) != 5 || page[0].Time != 80 {
		t.Fatalf("page 3 = %d items from %v, total %d", len(page), page[0].Time, total)
	}
	if page, total := FeedPage(snaps, FeedFilter{Limit: 10, Offset: 40}); total != 25 || len(page) != 0 {
		t.Fatalf("past the end = %d items, total %d", len(page), total)
	}
}
