package copytrade

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"nofx/store"
)

// fakeBinance serves one public-position trader's detail, performance,
// positions and a growing trade history (newest first).
type fakeBinance struct {
	mu      sync.Mutex
	trades  []map[string]any
	limited bool
	calls   map[string]int
}

func (f *fakeBinance) add(t time.Time, side, ps string, qty, price, pnl float64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	row := map[string]any{"time": t.UnixMilli(), "symbol": "BTCUSDT", "side": side, "positionSide": ps,
		"qty": qty, "price": price, "fee": 0.1, "realizedProfit": pnl}
	f.trades = append([]map[string]any{row}, f.trades...)
}

func (f *fakeBinance) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls[r.URL.Path]++
	write := func(data any) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": "000000", "data": data})
	}
	if f.limited {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": "11012005", "data": nil})
		return
	}
	switch r.URL.Path {
	case "/v1/friendly/future/copy-trade/lead-portfolio/detail":
		if r.URL.Query().Get("portfolioId") != "42" {
			write(nil)
			return
		}
		write(map[string]any{"leadPortfolioId": "42", "nickname": "测试员", "status": "ACTIVE", "positionShow": true,
			"aumAmount": "1000", "currentCopyCount": 3, "maxCopyCount": 100})
	case "/v1/public/future/copy-trade/lead-portfolio/performance":
		write(map[string]any{"roi": 12.5, "pnl": 300, "mdd": 4, "winRate": 60})
	case "/v1/friendly/future/copy-trade/lead-data/positions":
		write([]map[string]any{
			{"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmount": "1.5", "entryPrice": "101", "markPrice": "105",
				"leverage": 10, "unrealizedProfit": "6", "notionalValue": "157.5"},
			{"symbol": "ETHUSDT", "positionSide": "LONG", "positionAmount": "0", "entryPrice": "0"},
		})
	case "/v1/friendly/future/copy-trade/lead-portfolio/trade-history":
		var body struct{ PageNumber, PageSize int }
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		from := (body.PageNumber - 1) * body.PageSize
		to := min(from+body.PageSize, len(f.trades))
		page := []map[string]any{}
		if from < len(f.trades) {
			page = f.trades[from:to]
		}
		write(map[string]any{"total": len(f.trades), "list": page})
	default:
		http.NotFound(w, r)
	}
}

func newTestMonitor(t *testing.T) (*Monitor, *fakeBinance) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	st := store.NewCopyTradeStore(db)
	if err := st.InitTables(); err != nil {
		t.Fatal(err)
	}
	fake := &fakeBinance{calls: map[string]int{}}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	m := NewMonitor(st)
	m.Client.BaseURL, m.Client.Spacing = srv.URL, 0
	return m, fake
}

func TestMonitorBackfillsThenAddsOnlyNewFills(t *testing.T) {
	m, fake := newTestMonitor(t)
	ctx := context.Background()
	now := time.Now()
	fake.add(now.Add(-10*24*time.Hour), "BUY", "LONG", 9, 90, 0) // older than the 7-day backfill
	fake.add(now.Add(-3*time.Hour), "BUY", "LONG", 1, 100, 0)
	fake.add(now.Add(-2*time.Hour), "BUY", "LONG", 0.5, 103, 0)

	if _, err := m.Follow(ctx, "nope"); err == nil {
		t.Fatal("following an unknown ID must fail")
	}
	f, err := m.Follow(ctx, "42")
	if err != nil || f.Nickname != "测试员" || !f.PositionShow {
		t.Fatalf("follow = %+v, %v", f, err)
	}
	if _, err := m.Follow(ctx, "42"); err == nil {
		t.Fatal("following twice must fail")
	}
	m.refresh(ctx, "42")
	s, _ := m.Snapshot("42")
	if s.Error != "" || s.Follow.ROI != 12.5 || s.PositionsSource != "public" || len(s.Positions) != 1 {
		t.Fatalf("snapshot = %+v", s)
	}
	p := s.Positions[0]
	if p.Leverage != 10 || p.Margin != 15.15 || p.OpenedAt != now.Add(-3*time.Hour).UnixMilli() {
		t.Fatalf("public position must take the rebuilt open time: %+v", p)
	}
	if len(s.Events) != 2 || s.Events[0].Action != "add" || s.Events[1].Action != "open" {
		t.Fatalf("events newest first, without the 10-day-old fill: %+v", s.Events)
	}

	// A second refresh stores only the new fill and does not duplicate.
	fake.add(now.Add(-time.Minute), "SELL", "LONG", 1.5, 110, 13)
	m.refresh(ctx, "42")
	fills, _ := m.store.Fills("42", 0)
	if len(fills) != 3 {
		t.Fatalf("stored fills = %d, want 3", len(fills))
	}
	s, _ = m.Snapshot("42")
	if s.Events[0].Action != "close" || !s.Hot {
		t.Fatalf("latest event = %+v hot=%v", s.Events[0], s.Hot)
	}
	if fake.calls["/v1/public/future/copy-trade/lead-portfolio/performance"] != 1 {
		t.Fatal("profile must not be refetched every cycle")
	}

	if err := m.Unfollow("42"); err != nil {
		t.Fatal(err)
	}
	if fills, _ := m.store.Fills("42", 0); len(fills) != 0 {
		t.Fatal("unfollow must delete stored fills")
	}
}

func TestClientPausesWhenLimited(t *testing.T) {
	m, fake := newTestMonitor(t)
	fake.limited = true
	_, err := m.Client.Detail(context.Background(), "42")
	var limited *limitedError
	if !errors.As(err, &limited) {
		t.Fatalf("code 11012005 must count as rate limiting: %v", err)
	}
	st := m.Client.Status()
	if !st.Paused || time.Until(st.PausedUntil) < 50*time.Second {
		t.Fatalf("status = %+v", st)
	}
	before := fake.calls["/v1/friendly/future/copy-trade/lead-portfolio/detail"]
	if _, err := m.Client.Detail(context.Background(), "42"); !errors.Is(err, ErrPaused) {
		t.Fatalf("paused client must not call Binance: %v", err)
	}
	if fake.calls["/v1/friendly/future/copy-trade/lead-portfolio/detail"] != before {
		t.Fatal("request sent while paused")
	}
}

func TestProxyValidationAndMask(t *testing.T) {
	for _, bad := range []string{"ftp://1.2.3.4:21", "http://1.2.3.4", "http://1.2.3.4:8080/path", "nonsense"} {
		if _, err := ParseProxy(bad); err == nil {
			t.Errorf("%q must be rejected", bad)
		}
	}
	for _, ok := range []string{"http://1.2.3.4:8080", "socks5://u:p@proxy.example:1080", "socks5h://h:1"} {
		if _, err := ParseProxy(ok); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}
	if got := MaskProxy("http://user:secret@1.2.3.4:8080"); got != "http://user:***@1.2.3.4:8080" {
		t.Fatalf("mask = %s", got)
	}
}
