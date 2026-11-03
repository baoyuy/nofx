package copytrade

import (
	"context"
	"testing"
	"time"

	"nofx/store"
)

func TestScoreTraderPrefersSteadyOverGamblers(t *testing.T) {
	now := time.Now()
	start := now.Add(-120 * 24 * time.Hour).UnixMilli()
	steady := store.CopyTradeFollow{ROI: 40, MDD: 8, WinRate: 70, AUM: 200000, CopyCount: 300, StartTime: start, PositionShow: true}
	gambler := store.CopyTradeFollow{ROI: 5000, MDD: 66, WinRate: 43, AUM: 80000, CopyCount: 400, StartTime: start}
	newbie := steady
	newbie.StartTime = now.Add(-5 * 24 * time.Hour).UnixMilli()
	s, g, n := ScoreTrader(steady, now), ScoreTrader(gambler, now), ScoreTrader(newbie, now)
	if s.Score <= g.Score {
		t.Fatalf("steady %.1f must beat a 66%% drawdown gambler %.1f", s.Score, g.Score)
	}
	if n.Score >= s.Score {
		t.Fatalf("a 5-day-old record %.1f must score below the same record at 120 days %.1f", n.Score, s.Score)
	}
	if loser := ScoreTrader(store.CopyTradeFollow{ROI: -20, MDD: 30}, now); loser.Quality != 0 {
		t.Fatalf("negative ROI must give no quality: %+v", loser)
	}
	if s.Score < 0 || s.Score > 100 {
		t.Fatalf("score out of range: %v", s.Score)
	}
}

func TestConfidenceNeedsAgreementAndTraders(t *testing.T) {
	one := confidence([]vote{{trader: "a", side: "long", weight: 50, score: 80}})
	many := confidence([]vote{
		{trader: "a", side: "long", weight: 50, score: 80}, {trader: "b", side: "long", weight: 50, score: 80},
		{trader: "c", side: "long", weight: 50, score: 80}, {trader: "d", side: "long", weight: 50, score: 80},
		{trader: "e", side: "long", weight: 50, score: 80}, {trader: "f", side: "long", weight: 50, score: 80},
	})
	split := confidence([]vote{
		{trader: "a", side: "long", weight: 50, score: 80}, {trader: "b", side: "short", weight: 50, score: 80},
		{trader: "c", side: "long", weight: 50, score: 80}, {trader: "d", side: "short", weight: 50, score: 80},
	})
	if one.Direction != "long" || one.Score > 30 {
		t.Fatalf("one trader must not be confident: %+v", one)
	}
	if many.Score < 70 || many.Agreement != 1 {
		t.Fatalf("six agreeing good traders must be high confidence: %+v", many)
	}
	if split.Direction != "neutral" || split.Score != 0 {
		t.Fatalf("an even split has no direction: %+v", split)
	}
	weak := confidence([]vote{
		{trader: "a", side: "long", weight: 50, score: 10}, {trader: "b", side: "long", weight: 50, score: 10},
		{trader: "c", side: "long", weight: 50, score: 10}, {trader: "d", side: "long", weight: 50, score: 10},
		{trader: "e", side: "long", weight: 50, score: 10}, {trader: "f", side: "long", weight: 50, score: 10},
	})
	if weak.Score >= many.Score {
		t.Fatalf("weak traders must lower confidence: weak %.1f vs good %.1f", weak.Score, many.Score)
	}
	hedged := confidence([]vote{{trader: "a", side: "long", weight: 50, score: 80}, {trader: "a", side: "short", weight: 10, score: 80}})
	if hedged.Traders != 1 {
		t.Fatalf("a hedged trader counts once: %+v", hedged)
	}
}

func TestSignalsRecordEvaluateAndHitRate(t *testing.T) {
	m, _ := newTestMonitor(t)
	ctx := context.Background()
	hour := time.Now().Truncate(time.Hour).Add(-30 * time.Hour)
	// Price rises 1% per hour from 100; like Binance, only candles closed
	// by the clock are returned.
	clock := hour.Add(10 * time.Minute)
	m.Bars = func(_ context.Context, _ string, limit int) ([]Bar, error) {
		var bars []Bar
		for i := 0; i < 60; i++ {
			at := hour.Add(time.Duration(i-5) * time.Hour)
			if at.Add(time.Hour).After(clock) {
				break
			}
			bars = append(bars, Bar{Time: at.Unix(), Close: 100 * (1 + 0.01*float64(i-5))})
		}
		return bars[max(0, len(bars)-limit):], nil
	}
	start := time.Now().Add(-200 * 24 * time.Hour).UnixMilli()
	for i, side := range []string{"long", "long", "long", "long", "long", "short"} {
		id := string(rune('a' + i))
		m.snaps[id] = &Snapshot{
			Follow:    store.CopyTradeFollow{PortfolioID: id, ROI: 50, MDD: 10, WinRate: 70, StartTime: start, PositionShow: true, MarginBalance: 1000},
			Positions: []Position{{Symbol: "BTCUSDT", Side: side, Qty: 1, EntryPrice: 100, EntryValue: 500}},
			UpdatedAt: hour.Add(10 * time.Minute),
		}
	}
	if err := m.RecordSignals(ctx, hour.Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := m.RecordSignals(ctx, hour.Add(20*time.Minute)); err != nil {
		t.Fatal(err)
	}
	sigs, _ := m.store.PendingSignals(time.Now().Unix())
	if len(sigs) != 1 || sigs[0].Direction != "long" || sigs[0].Price != 99 {
		t.Fatalf("one signal per hour priced at the previous close: %+v", sigs)
	}
	clock = time.Now()
	if err := m.EvaluateSignals(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	rates, err := m.HitRates(0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range rates {
		if r.Band == "all" && r.Horizon == "4h" {
			found = true
			// 99 → close of hour+3 (=103): long called right.
			if r.Samples != 1 || r.Hits != 1 || r.AvgReturn < 0.03 {
				t.Fatalf("4h hit rate: %+v", r)
			}
		}
		if r.Band == "all" && r.Horizon == "24h" && r.Samples != 1 {
			t.Fatalf("24h result missing: %+v", r)
		}
	}
	if !found {
		t.Fatal("no 4h row")
	}
}
