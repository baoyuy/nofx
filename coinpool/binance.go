package coinpool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// Intervals the horn screener supports.
var Intervals = map[string]bool{"15m": true, "1h": true, "4h": true}

const (
	gainersLimit = 50
	klineLimit   = 200
	boardTTL     = 60 * time.Second
)

// Ticker is a Binance USDT-M perpetual's 24h statistics.
type Ticker struct {
	Symbol      string  `json:"symbol"`
	Price       float64 `json:"price"`
	ChangePct   float64 `json:"change_pct"`
	QuoteVolume float64 `json:"quote_volume"`
}

// HornRow is one market on the horn board.
type HornRow struct {
	Ticker
	HornResult
	Error string `json:"error,omitempty"`
}

// HornBoard is the horn screen of the top gainers on one interval.
type HornBoard struct {
	Interval  string    `json:"interval"`
	Rows      []HornRow `json:"rows"`
	Scanned   int       `json:"scanned"`
	Matched   int       `json:"matched"`
	FetchedAt time.Time `json:"fetched_at"`
}

// Screener reads public Binance futures data. One screener is shared by all
// users; boards are cached briefly so page refreshes reuse one scan.
type Screener struct {
	BaseURL string
	HTTP    *http.Client

	mu      sync.Mutex
	boards  map[string]HornBoard
	perps   map[string]bool
	perpsAt time.Time
	flight  singleflight.Group
}

func NewScreener() *Screener {
	return &Screener{BaseURL: "https://fapi.binance.com", HTTP: &http.Client{Timeout: 15 * time.Second}, boards: map[string]HornBoard{}}
}

func (s *Screener) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.BaseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("binance futures HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
}

// perpetuals lists tradable USDT-margined crypto perpetuals (no stock or
// commodity contracts), cached for an hour.
func (s *Screener) perpetuals(ctx context.Context) (map[string]bool, error) {
	s.mu.Lock()
	if s.perps != nil && time.Since(s.perpsAt) < time.Hour {
		defer s.mu.Unlock()
		return s.perps, nil
	}
	s.mu.Unlock()
	var info struct {
		Symbols []struct {
			Symbol, QuoteAsset, MarginAsset, Status, ContractType string
		}
	}
	if err := s.get(ctx, "/fapi/v1/exchangeInfo", &info); err != nil {
		return nil, err
	}
	perps := map[string]bool{}
	for _, m := range info.Symbols {
		if m.Status == "TRADING" && m.QuoteAsset == "USDT" && m.MarginAsset == "USDT" && m.ContractType == "PERPETUAL" {
			perps[m.Symbol] = true
		}
	}
	s.mu.Lock()
	s.perps, s.perpsAt = perps, time.Now()
	s.mu.Unlock()
	return perps, nil
}

// Gainers returns the top n crypto perpetuals by 24h price change.
func (s *Screener) Gainers(ctx context.Context, n int) ([]Ticker, error) {
	perps, err := s.perpetuals(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct{ Symbol, LastPrice, PriceChangePercent, QuoteVolume string }
	if err := s.get(ctx, "/fapi/v1/ticker/24hr", &rows); err != nil {
		return nil, err
	}
	out := make([]Ticker, 0, len(rows))
	for _, r := range rows {
		if !perps[r.Symbol] {
			continue
		}
		price, e1 := strconv.ParseFloat(r.LastPrice, 64)
		change, e2 := strconv.ParseFloat(r.PriceChangePercent, 64)
		volume, _ := strconv.ParseFloat(r.QuoteVolume, 64)
		if e1 != nil || e2 != nil || price <= 0 {
			continue
		}
		out = append(out, Ticker{Symbol: r.Symbol, Price: price, ChangePct: change, QuoteVolume: volume})
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].ChangePct > out[b].ChangePct })
	if len(out) > n {
		out = out[:n]
	}
	return out, nil
}

// closedCloses returns closes of finished candles, oldest first.
func (s *Screener) closedCloses(ctx context.Context, symbol, interval string) ([]float64, error) {
	var rows [][]json.RawMessage
	q := url.Values{"symbol": {symbol}, "interval": {interval}, "limit": {strconv.Itoa(klineLimit)}}
	if err := s.get(ctx, "/fapi/v1/klines?"+q.Encode(), &rows); err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, errors.New("not enough candles")
	}
	rows = rows[:len(rows)-1] // the newest candle is still forming
	out := make([]float64, 0, len(rows))
	for _, r := range rows {
		if len(r) < 5 {
			return nil, errors.New("invalid candle")
		}
		var raw string
		if json.Unmarshal(r[4], &raw) != nil {
			return nil, errors.New("invalid candle close")
		}
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil || v <= 0 {
			return nil, errors.New("invalid candle close")
		}
		out = append(out, v)
	}
	return out, nil
}

// HornBoard screens the top 50 gainers for the Bollinger horn on interval.
// Matches come first, then by score.
func (s *Screener) HornBoard(ctx context.Context, interval string, refresh bool) (HornBoard, error) {
	if !Intervals[interval] {
		return HornBoard{}, errors.New("unsupported interval")
	}
	s.mu.Lock()
	cached, ok := s.boards[interval]
	s.mu.Unlock()
	if ok && !refresh && time.Since(cached.FetchedAt) < boardTTL {
		return cached, nil
	}
	// One scan serves every waiting caller, so it must not end with the
	// first caller's request.
	v, err, _ := s.flight.Do(interval, func() (any, error) {
		scanCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		return s.scanHorn(scanCtx, interval)
	})
	if err != nil {
		return HornBoard{}, err
	}
	board := v.(HornBoard)
	s.mu.Lock()
	s.boards[interval] = board
	s.mu.Unlock()
	return board, nil
}

func (s *Screener) scanHorn(ctx context.Context, interval string) (HornBoard, error) {
	gainers, err := s.Gainers(ctx, gainersLimit)
	if err != nil {
		return HornBoard{}, err
	}
	rows := make([]HornRow, len(gainers))
	var wg sync.WaitGroup
	slots := make(chan struct{}, 8)
	failed := 0
	var mu sync.Mutex
	for i, t := range gainers {
		wg.Add(1)
		go func(i int, t Ticker) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			rows[i] = HornRow{Ticker: t, HornResult: HornResult{Direction: "neutral", Stage: "none"}}
			closes, err := s.closedCloses(ctx, t.Symbol, interval)
			if err != nil {
				rows[i].Error = "candles unavailable"
				mu.Lock()
				failed++
				mu.Unlock()
				return
			}
			rows[i].HornResult = AnalyzeHorn(closes)
		}(i, t)
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return HornBoard{}, err
	}
	if len(gainers) == 0 || failed > len(gainers)/2 {
		return HornBoard{}, errors.New("Binance candles unavailable for the screen")
	}
	sort.SliceStable(rows, func(a, b int) bool {
		if rows[a].Match != rows[b].Match {
			return rows[a].Match
		}
		return rows[a].Score > rows[b].Score
	})
	board := HornBoard{Interval: interval, Rows: rows, Scanned: len(gainers), FetchedAt: time.Now().UTC()}
	for _, r := range rows {
		if r.Match {
			board.Matched++
		}
	}
	return board, nil
}
