package kernel

import (
	"strings"
	"testing"
	"time"

	"nofx/market"
	"nofx/store"
)

func withCopyTrade(t *testing.T, coins []CopyTradeCoin) {
	t.Helper()
	prev := CopyTradeResolver
	CopyTradeResolver = func() []CopyTradeCoin { return coins }
	t.Cleanup(func() { CopyTradeResolver = prev })
}

var sampleCoins = []CopyTradeCoin{
	{Symbol: "ETHUSDT", Direction: "short", Confidence: 62, Short: CopyTradeSide{Traders: 4, Value: 9000, AvgEntry: 2300, Fresh: 1}},
	{Symbol: "SNDKUSDT", Direction: "long", Confidence: 55, Long: CopyTradeSide{Traders: 6, Value: 5000, AvgEntry: 1100, Trapped: 4},
		Recent: []CopyTradeAction{{Time: time.Now().Add(-90 * time.Minute).UnixMilli(), Trader: "黑石策略", Score: 80, Side: "long", Action: "add", Value: 241, Price: 1146.4}},
		Holders: []CopyTradeHolder{
			{Trader: "黑石策略", Score: 80, Side: "long", Entry: 1090.3, Value: 1319, Leverage: 10, ReturnPct: -42.5, Priced: true,
				OpenedAt: time.Now().Add(-26 * time.Hour).UnixMilli(), Trapped: false},
			{Trader: "小小羊", Score: 86, Side: "long", Entry: 1150, Value: 2000, ReturnPct: -6.2, Priced: true, Trapped: true, HighFreq: true},
		}},
	{Symbol: "XRPUSDT", Direction: "long", Confidence: 70, Long: CopyTradeSide{Traders: 1, Value: 300}},
	{Symbol: "BCHUSDT", Direction: "long", Confidence: 30, Long: CopyTradeSide{Traders: 3, Value: 800}},
	{Symbol: "BZUSDT", Direction: "neutral", Confidence: 0, Long: CopyTradeSide{Traders: 1}, Short: CopyTradeSide{Traders: 1}},
}

func symbols(c []CandidateCoin) []string {
	out := make([]string, len(c))
	for i, x := range c {
		out[i] = x.Symbol
	}
	return out
}

func TestCopyTradeCandidatesFilterAndRank(t *testing.T) {
	withCopyTrade(t, sampleCoins)
	src := store.CoinSourceConfig{SourceType: "copy_trade"}
	// Defaults: confidence 40+, 2+ traders, both sides, by confidence.
	if got := symbols(copyTradeCandidates(src)); strings.Join(got, ",") != "ETHUSDT,SNDKUSDT" {
		t.Fatalf("defaults: %v", got)
	}
	src.CopyTradeDirection, src.CopyTradeMinTraders = "long", 1
	if got := symbols(copyTradeCandidates(src)); strings.Join(got, ",") != "XRPUSDT,SNDKUSDT" {
		t.Fatalf("long only, 1+ trader: %v", got)
	}
	src.CopyTradeLimit = 1
	if got := copyTradeCandidates(src); len(got) != 1 || got[0].Sources[0] != "copy_trade" {
		t.Fatalf("limit 1: %+v", got)
	}
	CopyTradeResolver = nil
	if got := copyTradeCandidates(src); len(got) != 0 {
		t.Fatal("no monitor, no coins")
	}
}

func TestCopyTradePromptOnlyWhenAsked(t *testing.T) {
	withCopyTrade(t, sampleCoins)
	cfg := store.GetDefaultStrategyConfig("en")
	cfg.CoinSource.SourceType, cfg.CoinSource.StaticCoins = "static", []string{"SNDKUSDT"}
	engine := NewStrategyEngine(&cfg)
	ctx := &Context{CandidateCoins: []CandidateCoin{{Symbol: "SNDKUSDT"}}}
	enrichCopyTradeData(ctx, engine)
	if ctx.CopyTradeMap != nil || strings.Contains(engine.BuildSystemPrompt(1000, ""), "Followed Lead Traders") {
		t.Fatal("a strategy without copy-trade context must not get it")
	}

	cfg.CoinSource.CopyTradeContext = true
	engine = NewStrategyEngine(&cfg)
	enrichCopyTradeData(ctx, engine)
	block := formatCopyTrade(copyTradeFor(ctx, "SNDK"), time.Now(), 1155, "")
	for _, want := range []string{"leaning LONG, confidence 55/100", "6 traders", "4 trapped", "avg entry 1100.00",
		"Short: none", "黑石策略 (score 80) add long 241 USDT @ 1146.40", "1.5h ago",
		"Holders (most credible first)", "黑石策略 (score 80) long 1319 USDT @ 1090.30, 10x, -42.5% of margin, held 26.0h",
		"小小羊 (score 86) long 2000 USDT @ 1150.00, -6.2% price, held since before monitoring [trapped, high-frequency]",
		"Price vs lead long avg entry: +5.0% (beyond their entry in their direction: chasing)"} {
		if !strings.Contains(block, want) {
			t.Fatalf("block missing %q:\n%s", want, block)
		}
	}
	if sp := engine.BuildSystemPrompt(1000, ""); !strings.Contains(sp, "Never open a trade only because lead traders hold it") || strings.Contains(sp, "RULE (enforced") {
		t.Fatal("system prompt explains the copy-trade block")
	}
}

func TestCopyTradeSourceNormalizes(t *testing.T) {
	cfg := store.GetDefaultStrategyConfig("en")
	cfg.CoinSource = store.CoinSourceConfig{SourceType: "copy trade", CopyTradeLimit: 50, CopyTradeDirection: "up"}
	cfg.ClampLimits()
	c := cfg.CoinSource
	if c.SourceType != "copy_trade" || !c.CopyTradeContext || c.CopyTradeLimit != store.MaxCandidateCoins ||
		c.CopyTradeDirection != "both" || c.CopyTradeMinConfidence != store.DefaultCopyTradeMinConfidence {
		t.Fatalf("normalized: %+v", c)
	}
}

func TestCandidatesUseTheExchangeSymbols(t *testing.T) {
	withCopyTrade(t, sampleCoins)
	cfg := store.GetDefaultStrategyConfig("en")
	cfg.CoinSource = store.CoinSourceConfig{SourceType: "copy_trade"}
	engine := NewStrategyEngine(&cfg)
	for exchange, want := range map[string]string{"binance_paper": "SNDKUSDT", "binance": "SNDKUSDT", "hyperliquid": "xyz:SNDK"} {
		engine.SetExchange(exchange)
		got, err := engine.GetCandidateCoins()
		if err != nil || len(got) != 2 || got[1].Symbol != want {
			t.Fatalf("%s: %+v %v", exchange, got, err)
		}
		// Copy-trade data is found whatever the form.
		ctx := &Context{CandidateCoins: got}
		ctx.CopyTradeMap = nil
		enrichCopyTradeData(ctx, engine)
		if copyTradeFor(ctx, got[1].Symbol) == nil {
			t.Fatalf("%s: no copy-trade data for %s", exchange, got[1].Symbol)
		}
		briefs := CopyTradeBriefs(ctx, time.Now())
		if len(briefs) != 2 || briefs[1].Symbol != want || !strings.Contains(briefs[1].Text, "Holders") {
			t.Fatalf("%s: briefs %+v", exchange, briefs)
		}
	}
}

func TestOpenBlockReasonFollowFadeAndStopDistance(t *testing.T) {
	withCopyTrade(t, sampleCoins)
	cfg := store.GetDefaultStrategyConfig("en")
	cfg.CoinSource = store.CoinSourceConfig{SourceType: "copy_trade"}
	cfg.Indicators.Klines.PrimaryTimeframe = "1h"
	engine := NewStrategyEngine(&cfg)
	engine.SetExchange("binance_paper")
	ctx := &Context{MarketDataMap: map[string]*market.Data{
		"SNDKUSDT": {CurrentPrice: 1100, TimeframeData: map[string]*market.TimeframeSeriesData{"1h": {ATR14: 20}}},
	}}
	enrichCopyTradeData(ctx, engine)
	open := func(action string, stop float64) string {
		return engine.OpenBlockReason(Decision{Symbol: "SNDKUSDT", Action: action, StopLoss: stop}, ctx)
	}
	// Default for the copy_trade source: follow. SNDK leans long.
	if r := open("open_long", 1000); r != "" {
		t.Fatalf("follow allows long: %s", r)
	}
	if r := open("open_short", 1200); !strings.Contains(r, "lean long") {
		t.Fatalf("follow rejects short: %q", r)
	}
	if r := engine.OpenBlockReason(Decision{Symbol: "BZUSDT", Action: "open_long", StopLoss: 1}, ctx); !strings.Contains(r, "do not lean") {
		t.Fatalf("follow rejects a neutral coin: %q", r)
	}
	if r := engine.OpenBlockReason(Decision{Symbol: "SNDKUSDT", Action: "close_long"}, ctx); r != "" {
		t.Fatalf("closes are never blocked: %s", r)
	}
	if !strings.Contains(engine.BuildSystemPrompt(1000, ""), "open only in the lead traders' leaning direction") {
		t.Fatal("the system prompt states the follow rule")
	}
	cfg.CoinSource.CopyTradeFollow = "fade"
	if open("open_long", 1000) == "" || open("open_short", 1200) != "" {
		t.Fatal("fade: only against the lean")
	}
	cfg.CoinSource.CopyTradeFollow = "free"
	if open("open_short", 1200) != "" {
		t.Fatal("free: either side")
	}
	// Stop distance: 1.5 ATR = 30 from 1100.
	cfg.RiskControl.MinStopATR = 1.5
	if r := open("open_long", 1080); !strings.Contains(r, "below the 1.5 ATR minimum") {
		t.Fatalf("a 1 ATR stop is rejected: %q", r)
	}
	if r := open("open_long", 1060); r != "" {
		t.Fatalf("a 2 ATR stop passes: %s", r)
	}
	if !strings.Contains(engine.BuildSystemPrompt(1000, ""), "at least 1.5 × ATR14") {
		t.Fatal("the system prompt states the stop distance")
	}
}

func TestCopyTradeExitAlerts(t *testing.T) {
	now := time.Now()
	closed := CopyTradeAction{Time: now.Add(-time.Hour).UnixMilli(), Trader: "A", Side: "long", Action: "close", Value: 100, Price: 10}
	cases := []struct {
		name string
		coin *CopyTradeCoin
		held string
		want string
	}{
		{"nobody left", &CopyTradeCoin{Direction: "neutral", Recent: []CopyTradeAction{closed}}, "long", "no one holds long any more (1 closed recently)"},
		{"flipped", &CopyTradeCoin{Direction: "short", Short: CopyTradeSide{Traders: 2}}, "long", "now hold short (flipped against your position)"},
		{"leaning against", &CopyTradeCoin{Direction: "short", Long: CopyTradeSide{Traders: 1}, Short: CopyTradeSide{Traders: 3}}, "long", "they now lean short, against your long position"},
		{"some exits", &CopyTradeCoin{Direction: "long", Long: CopyTradeSide{Traders: 2}, Recent: []CopyTradeAction{closed}}, "long", "1 of the recent long actions were closes or reductions"},
		{"still with you", &CopyTradeCoin{Direction: "long", Long: CopyTradeSide{Traders: 2}}, "long", ""},
		{"not held", &CopyTradeCoin{Direction: "neutral", Recent: []CopyTradeAction{closed}}, "", ""},
	}
	for _, c := range cases {
		got := copyTradeExitAlert(c.coin, c.held)
		if (c.want == "") != (got == "") || !strings.Contains(got, c.want) {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
	if got := formatCopyTrade(nil, now, 0, "short"); !strings.Contains(got, "none of the followed lead traders") {
		t.Errorf("held coin nobody traded: %q", got)
	}
	if got := copyTradeVsAvg(&CopyTradeCoin{Direction: "short", Short: CopyTradeSide{AvgEntry: 100}}, 104); !strings.Contains(got, "+4.0% (better than their entry, they are under water)") {
		t.Errorf("short side above average: %q", got)
	}
}
