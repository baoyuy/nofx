package copytrade

import (
	"testing"
	"time"

	"nofx/store"
)

func TestAssessHealthFlagsTrappedFreshAndLiquidated(t *testing.T) {
	now := time.Now()
	old := now.Add(-5 * 24 * time.Hour).UnixMilli()
	recent := now.Add(-time.Hour).UnixMilli()
	marks := map[string]float64{"BTCUSDT": 90, "ETHUSDT": 110, "SOLUSDT": 50}
	got := assessHealth([]Position{
		// Long 1 at 100, mark 90: -10% price move, no leverage known.
		{Symbol: "BTCUSDT", Side: "long", Qty: 1, EntryPrice: 100, EntryValue: 100, OpenedAt: old, Source: "inferred"},
		// Long at 100, mark 110, added an hour ago.
		{Symbol: "ETHUSDT", Side: "long", Qty: 1, EntryPrice: 100, EntryValue: 100, OpenedAt: old, LastAddAt: recent, Source: "inferred"},
		// Public: Binance's PnL and margin are kept, -5% of margin.
		{Symbol: "SOLUSDT", Side: "short", Qty: 1, EntryPrice: 48, EntryValue: 48, Margin: 40, MarkPrice: 50,
			UnrealizedPnL: -2, Source: "public"},
		// No mark price.
		{Symbol: "XYZUSDT", Side: "short", Qty: 1, EntryPrice: 1, EntryValue: 1, Source: "inferred"},
	}, marks, 1000, now)
	btc, eth, sol, xyz := got[0], got[1], got[2], got[3]
	if !btc.Priced || btc.UnrealizedPnL != -10 || btc.ReturnPct != -10 || btc.PctOfMargin || !btc.Trapped || btc.Fresh {
		t.Fatalf("btc: %+v", btc)
	}
	if eth.Trapped || !eth.Fresh || eth.UnrealizedPnL != 10 {
		t.Fatalf("eth: %+v", eth)
	}
	if !sol.PctOfMargin || sol.ReturnPct != -5 || sol.Trapped || sol.UnrealizedPnL != -2 {
		t.Fatalf("sol: %+v", sol)
	}
	if xyz.Priced || xyz.Trapped {
		t.Fatalf("xyz: %+v", xyz)
	}
	if btc.Liquidated {
		t.Fatal("a 10 USDT loss on a 1000 balance is not a liquidation")
	}
	// The same loss on a 10 USDT balance wiped the account.
	gone := assessHealth([]Position{
		{Symbol: "BTCUSDT", Side: "long", Qty: 1, EntryPrice: 100, EntryValue: 100, Source: "inferred"},
		{Symbol: "ETHUSDT", Side: "long", Qty: 1, EntryPrice: 100, EntryValue: 100, Source: "inferred"},
	}, marks, 10, now)
	if !gone[0].Liquidated || gone[0].Trapped || gone[1].Liquidated {
		t.Fatalf("only the losing position is liquidated: %+v", gone)
	}
}

func TestSymbolsDiscountTrappedAndDropLiquidated(t *testing.T) {
	now := time.Now()
	snap := func(id string, balance float64, p Position) Snapshot {
		return Snapshot{Follow: store.CopyTradeFollow{PortfolioID: id, MarginBalance: balance},
			Score: TraderScore{Score: 60}, Positions: assessHealth([]Position{p}, map[string]float64{"BTCUSDT": 80}, balance, now)}
	}
	long := Position{Symbol: "BTCUSDT", Side: "long", Qty: 1, EntryPrice: 100, EntryValue: 100, Source: "inferred"}
	short := Position{Symbol: "BTCUSDT", Side: "short", Qty: 1, EntryPrice: 81, EntryValue: 81, Source: "inferred",
		OpenedAt: now.Add(-time.Hour).UnixMilli()}
	// Three longs down 20% (trapped), one fresh short: votes favour the short.
	sums := Symbols([]Snapshot{snap("a", 1000, long), snap("b", 1000, long), snap("c", 1000, long), snap("d", 1000, short),
		// Lost more than its balance: likely liquidated, not counted.
		snap("e", 5, long)})
	s := sums[0]
	if s.Long.Traders != 3 || s.Long.Trapped != 3 || s.Short.Traders != 1 || s.Short.Fresh != 1 || s.Liquidated != 1 {
		t.Fatalf("counts: %+v", s)
	}
	if s.Confidence.Direction != "short" || s.Confidence.Traders != 4 {
		t.Fatalf("three traders sitting on 200%%-of-margin losses must count less than one fresh short: %+v", s.Confidence)
	}
	healthy := Symbols([]Snapshot{{Follow: store.CopyTradeFollow{PortfolioID: "a", MarginBalance: 1000},
		Score: TraderScore{Score: 60}, Positions: []Position{long}}})
	if healthy[0].Confidence.Direction != "long" {
		t.Fatalf("unpriced long still votes long: %+v", healthy[0].Confidence)
	}
}
