package kernel

import (
	"strings"
	"testing"
	"time"

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
	block := formatCopyTrade(copyTradeFor(ctx, "SNDK"), time.Now())
	for _, want := range []string{"leaning LONG, confidence 55/100", "6 traders", "4 trapped", "avg entry 1100.00",
		"Short: none", "黑石策略 (score 80) add long 241 USDT @ 1146.40", "1.5h ago",
		"Holders (most credible first)", "黑石策略 (score 80) long 1319 USDT @ 1090.30, 10x, -42.5% of margin, held 26.0h",
		"小小羊 (score 86) long 2000 USDT @ 1150.00, -6.2% price, held since before monitoring [trapped, high-frequency]"} {
		if !strings.Contains(block, want) {
			t.Fatalf("block missing %q:\n%s", want, block)
		}
	}
	if !strings.Contains(engine.BuildSystemPrompt(1000, ""), "Never open a trade only because lead traders hold it") {
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
