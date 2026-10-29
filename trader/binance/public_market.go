package binance

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/adshao/go-binance/v2/futures"
)

// Public Binance USDT-M market data. No API key; used by the market page,
// AI analysis and the paper simulator's chart.

type MarketKline struct {
	Time   int64   `json:"time"` // open time, unix seconds
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

type MarketTicker struct {
	Symbol          string  `json:"symbol"`
	LastPrice       float64 `json:"last_price"`
	MarkPrice       float64 `json:"mark_price"`
	PriceChange     float64 `json:"price_change"`
	PriceChangePct  float64 `json:"price_change_pct"`
	High24h         float64 `json:"high_24h"`
	Low24h          float64 `json:"low_24h"`
	Volume24h       float64 `json:"volume_24h"`
	QuoteVolume24h  float64 `json:"quote_volume_24h"`
	FundingRate     float64 `json:"funding_rate"`
	NextFundingTime int64   `json:"next_funding_time"`
}

var (
	publicClientOnce sync.Once
	publicClient     *futures.Client

	symbolsMu       sync.Mutex
	symbolsCache    []string
	symbolsCachedAt time.Time
)

func marketClient() *futures.Client {
	publicClientOnce.Do(func() {
		publicClient = futures.NewClient("", "")
		publicClient.HTTPClient = &http.Client{Timeout: 15 * time.Second}
	})
	return publicClient
}

// ValidMarketIntervals are the chart periods the market page offers.
var ValidMarketIntervals = map[string]bool{
	"1m": true, "3m": true, "5m": true, "15m": true, "30m": true,
	"1h": true, "2h": true, "4h": true, "6h": true, "12h": true,
	"1d": true, "3d": true, "1w": true,
}

func parseF(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

// GetPublicKlines returns up to limit candles, oldest first.
func GetPublicKlines(ctx context.Context, symbol, interval string, limit int) ([]MarketKline, error) {
	if !ValidMarketIntervals[interval] {
		return nil, fmt.Errorf("unsupported interval %q", interval)
	}
	if limit <= 0 || limit > 1500 {
		limit = 500
	}
	rows, err := marketClient().NewKlinesService().
		Symbol(symbol).Interval(interval).Limit(limit).Do(ctx)
	if err != nil {
		return nil, fmt.Errorf("binance klines: %w", err)
	}
	out := make([]MarketKline, 0, len(rows))
	for _, k := range rows {
		out = append(out, MarketKline{
			Time: k.OpenTime / 1000, Open: parseF(k.Open), High: parseF(k.High),
			Low: parseF(k.Low), Close: parseF(k.Close), Volume: parseF(k.Volume),
		})
	}
	return out, nil
}

// GetPublicTicker combines 24h stats with mark price and funding rate.
func GetPublicTicker(ctx context.Context, symbol string) (*MarketTicker, error) {
	stats, err := marketClient().NewListPriceChangeStatsService().Symbol(symbol).Do(ctx)
	if err != nil {
		return nil, fmt.Errorf("binance 24h ticker: %w", err)
	}
	if len(stats) == 0 {
		return nil, fmt.Errorf("symbol %s not found", symbol)
	}
	s := stats[0]
	t := &MarketTicker{
		Symbol: s.Symbol, LastPrice: parseF(s.LastPrice), PriceChange: parseF(s.PriceChange),
		PriceChangePct: parseF(s.PriceChangePercent), High24h: parseF(s.HighPrice),
		Low24h: parseF(s.LowPrice), Volume24h: parseF(s.Volume), QuoteVolume24h: parseF(s.QuoteVolume),
	}
	// Funding is supplementary; the ticker is still useful without it.
	if prem, err := marketClient().NewPremiumIndexService().Symbol(symbol).Do(ctx); err == nil && len(prem) > 0 {
		t.MarkPrice = parseF(prem[0].MarkPrice)
		t.FundingRate = parseF(prem[0].LastFundingRate)
		t.NextFundingTime = prem[0].NextFundingTime
	}
	return t, nil
}

// GetPublicSymbols lists trading USDT perpetuals, cached for an hour.
func GetPublicSymbols(ctx context.Context) ([]string, error) {
	symbolsMu.Lock()
	defer symbolsMu.Unlock()
	if len(symbolsCache) > 0 && time.Since(symbolsCachedAt) < time.Hour {
		return symbolsCache, nil
	}
	info, err := marketClient().NewExchangeInfoService().Do(ctx)
	if err != nil {
		return nil, fmt.Errorf("binance exchangeInfo: %w", err)
	}
	var out []string
	for _, s := range info.Symbols {
		if s.QuoteAsset == "USDT" && s.ContractType == "PERPETUAL" && s.Status == "TRADING" {
			out = append(out, s.Symbol)
		}
	}
	sort.Strings(out)
	symbolsCache, symbolsCachedAt = out, time.Now()
	return out, nil
}

// MarketTickerLite is one row of the coin list / gainers ranking.
type MarketTickerLite struct {
	Symbol         string  `json:"symbol"`
	LastPrice      float64 `json:"last_price"`
	PriceChangePct float64 `json:"price_change_pct"`
	QuoteVolume24h float64 `json:"quote_volume_24h"`
}

var (
	tickersMu       sync.Mutex
	tickersCache    []MarketTickerLite
	tickersCachedAt time.Time
)

// GetPublicTickers returns 24h stats for all trading USDT perpetuals.
// One Binance call covers every symbol; cached briefly so many open pages
// share it.
func GetPublicTickers(ctx context.Context) ([]MarketTickerLite, error) {
	tickersMu.Lock()
	defer tickersMu.Unlock()
	if len(tickersCache) > 0 && time.Since(tickersCachedAt) < 5*time.Second {
		return tickersCache, nil
	}
	symbols, err := GetPublicSymbols(ctx)
	if err != nil {
		return nil, err
	}
	trading := make(map[string]bool, len(symbols))
	for _, s := range symbols {
		trading[s] = true
	}
	stats, err := marketClient().NewListPriceChangeStatsService().Do(ctx)
	if err != nil {
		return nil, fmt.Errorf("binance 24h tickers: %w", err)
	}
	out := make([]MarketTickerLite, 0, len(symbols))
	for _, s := range stats {
		if !trading[s.Symbol] {
			continue
		}
		out = append(out, MarketTickerLite{
			Symbol: s.Symbol, LastPrice: parseF(s.LastPrice),
			PriceChangePct: parseF(s.PriceChangePercent), QuoteVolume24h: parseF(s.QuoteVolume),
		})
	}
	tickersCache, tickersCachedAt = out, time.Now()
	return out, nil
}

// NormalizeUSDTSymbol turns "btc", "BTC/USDT" or "btc-usdt" into "BTCUSDT".
func NormalizeUSDTSymbol(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = strings.NewReplacer("/", "", "-", "", "_", "", " ", "").Replace(s)
	if s != "" && !strings.HasSuffix(s, "USDT") {
		s += "USDT"
	}
	return s
}
