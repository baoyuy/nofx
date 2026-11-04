package api

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"nofx/copytrade"
	"nofx/kernel"
	"nofx/logger"
	"nofx/trader/binance"
)

// copyTradeProxyKey stores the encrypted proxy URL in system_config.
const copyTradeProxyKey = "copytrade_proxy"

var leadIDPattern = regexp.MustCompile(`\d{15,22}`)

// StartCopyTrade starts the copy-trade monitor with the saved proxy. It runs
// until ctx ends.
func (s *Server) StartCopyTrade(ctx context.Context) {
	m := copytrade.NewMonitor(s.store.CopyTrade())
	m.Bars = func(ctx context.Context, symbol string, limit int) ([]copytrade.Bar, error) {
		rows, err := binance.GetPublicKlines(ctx, symbol, "1h", limit)
		if err != nil {
			return nil, err
		}
		// The last candle is still forming.
		if len(rows) > 0 && time.Unix(rows[len(rows)-1].Time, 0).Add(time.Hour).After(time.Now()) {
			rows = rows[:len(rows)-1]
		}
		bars := make([]copytrade.Bar, len(rows))
		for i, r := range rows {
			bars[i] = copytrade.Bar{Time: r.Time, Close: r.Close}
		}
		return bars, nil
	}
	// fapi, not the copy-trade web API: does not count against its limits.
	m.Marks = binance.GetPublicMarkPrices
	if proxy, err := s.loadCopyTradeProxy(); err != nil {
		logger.Warnf("copy-trade: saved proxy not used: %v", err)
	} else if err := m.Client.SetProxy(proxy); err != nil {
		logger.Warnf("copy-trade: saved proxy not used: %v", err)
	}
	s.copyTrade = m
	kernel.CopyTradeResolver = func() []kernel.CopyTradeCoin { return copyTradeCoins(m, time.Now()) }
	go m.Run(ctx)
}

// copyTradeFreshness drops traders not refreshed for this long from the AI's
// view: a cold trader is refreshed every 15 minutes.
const copyTradeFreshness = 30 * time.Minute

// copyTradeCoins converts the monitor's coin summaries for the strategy
// engine.
func copyTradeCoins(m *copytrade.Monitor, now time.Time) []kernel.CopyTradeCoin {
	snaps := copytrade.Fresh(m.Snapshots(), copyTradeFreshness, now)
	scores := map[string]float64{}
	for _, s := range snaps {
		scores[s.Follow.PortfolioID] = s.Score.Score
	}
	recent := copytrade.RecentBySymbol(snaps, now.Add(-24*time.Hour).UnixMilli(), 6)
	side := func(s copytrade.SideSummary) kernel.CopyTradeSide {
		return kernel.CopyTradeSide{Traders: s.Traders, Value: s.Value, AvgEntry: s.AvgEntry, Trapped: s.Trapped, Fresh: s.Fresh}
	}
	sums := copytrade.Symbols(snaps)
	// High-frequency holders per side, for the prompt.
	hf := map[string]int{}
	for _, s := range snaps {
		if !s.HighFreq {
			continue
		}
		seen := map[string]bool{}
		for _, p := range s.Positions {
			if k := p.Symbol + "|" + p.Side; !seen[k] {
				seen[k] = true
				hf[k]++
			}
		}
	}
	out := make([]kernel.CopyTradeCoin, 0, len(sums))
	for _, c := range sums {
		coin := kernel.CopyTradeCoin{Symbol: c.Symbol, Direction: c.Confidence.Direction, Confidence: c.Confidence.Score,
			Long: side(c.Long), Short: side(c.Short), Liquidated: c.Liquidated}
		coin.Long.HighFreq, coin.Short.HighFreq = hf[c.Symbol+"|long"], hf[c.Symbol+"|short"]
		for _, e := range recent[c.Symbol] {
			coin.Recent = append(coin.Recent, kernel.CopyTradeAction{Time: e.Time, Trader: e.Nickname, Score: scores[e.PortfolioID],
				Side: e.Side, Action: e.Action, Value: e.Value, Price: e.Price, Realized: e.RealizedPnL})
		}
		out = append(out, coin)
	}
	return out
}

func (s *Server) loadCopyTradeProxy() (string, error) {
	stored, err := s.store.GetSystemConfig(copyTradeProxyKey)
	if err != nil || stored == "" {
		return "", err
	}
	return s.cryptoHandler.cryptoService.DecryptFromStorage(stored, copyTradeProxyKey)
}

func (s *Server) registerCopyTradeRoutes(protected *gin.RouterGroup) {
	s.route(protected, "GET", "/copytrade/status", "Copy-trade monitor status: rate limiting, proxy, followed traders", s.handleCopyTradeStatus)
	s.route(protected, "GET", "/copytrade/leaderboard", "Binance copy-trading lead traders (?time_range=7D|30D|90D&sort=ROI|PNL|COPIER_PNL&page=1&nickname=)", s.handleCopyTradeLeaderboard)
	s.route(protected, "GET", "/copytrade/follows", "Followed lead traders with their positions and latest actions", s.handleCopyTradeFollows)
	s.route(protected, "POST", "/copytrade/follows", "Follow a lead trader (body: id = portfolio ID or copy-trading page URL)", s.handleCopyTradeFollow)
	s.route(protected, "GET", "/copytrade/follows/:id", "One followed trader with positions and actions", s.handleCopyTradeFollowDetail)
	s.route(protected, "DELETE", "/copytrade/follows/:id", "Unfollow a lead trader", s.handleCopyTradeUnfollow)
	s.route(protected, "GET", "/copytrade/feed", "Actions of followed traders, newest first, paged (?portfolio_id=&symbol=&action=open|add|reduce|close&min_value=&hide_high_freq=1&page=1&page_size=50)", s.handleCopyTradeFeed)
	s.route(protected, "GET", "/copytrade/symbols", "Long/short totals per coin across followed traders", s.handleCopyTradeSymbols)
	s.route(protected, "GET", "/copytrade/symbols/:symbol", "Followed traders' positions in one coin with entry prices", s.handleCopyTradeSymbol)
	s.route(protected, "GET", "/copytrade/hit-rate", "How often hourly coin confidence signals moved the called way after 4h and 24h (?days=30)", s.handleCopyTradeHitRate)
	// The proxy URL may carry a password: keep these out of the AI route catalog.
	protected.GET("/copytrade/proxy", s.handleCopyTradeProxyGet)
	protected.PUT("/copytrade/proxy", s.handleCopyTradeProxyPut)
	protected.POST("/copytrade/proxy/test", s.handleCopyTradeProxyTest)
}

func (s *Server) copyTradeReady(c *gin.Context) bool {
	if s.copyTrade == nil {
		SafeError(c, http.StatusServiceUnavailable, "Copy-trade monitor is not running", nil)
		return false
	}
	return true
}

// copyTradeError turns monitor errors into readable responses.
func copyTradeError(c *gin.Context, err error) {
	if errors.Is(err, copytrade.ErrPaused) {
		SafeError(c, http.StatusServiceUnavailable, "Binance is rate limiting copy-trade requests; paused, retry later", err)
		return
	}
	SafeError(c, http.StatusBadGateway, "Could not read Binance copy-trading data: "+err.Error(), err)
}

func (s *Server) handleCopyTradeStatus(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	snaps := s.copyTrade.Snapshots()
	hot, failing := 0, 0
	var oldest time.Time
	for _, sn := range snaps {
		if sn.Hot {
			hot++
		}
		if sn.Error != "" {
			failing++
		}
		if !sn.UpdatedAt.IsZero() && (oldest.IsZero() || sn.UpdatedAt.Before(oldest)) {
			oldest = sn.UpdatedAt
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"client": s.copyTrade.Client.Status(), "follows": len(snaps), "max_follows": copytrade.MaxFollows,
		"hot": hot, "failing": failing, "oldest_update": oldest,
	})
}

func (s *Server) handleCopyTradeLeaderboard(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	q := copytrade.LeaderQuery{TimeRange: c.DefaultQuery("time_range", "30D"), SortBy: c.DefaultQuery("sort", "COPIER_PNL")}
	switch q.TimeRange {
	case "7D", "30D", "90D":
	default:
		SafeBadRequest(c, "time_range must be 7D, 30D or 90D")
		return
	}
	switch q.SortBy {
	case "ROI", "PNL", "COPIER_PNL":
	default:
		SafeBadRequest(c, "sort must be ROI, PNL or COPIER_PNL")
		return
	}
	q.Page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	if q.Page < 1 || q.Page > 50 {
		SafeBadRequest(c, "page must be 1-50")
		return
	}
	q.Nickname = strings.TrimSpace(c.Query("nickname"))
	if len([]rune(q.Nickname)) > 50 {
		SafeBadRequest(c, "nickname is at most 50 characters")
		return
	}
	page, err := s.copyTrade.Leaderboard(c.Request.Context(), q)
	if err != nil {
		copyTradeError(c, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

func (s *Server) handleCopyTradeFollows(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	snaps := s.copyTrade.Snapshots()
	for i := range snaps {
		if len(snaps[i].Events) > 5 {
			snaps[i].Events = snaps[i].Events[:5]
		}
	}
	c.JSON(http.StatusOK, gin.H{"follows": snaps, "max_follows": copytrade.MaxFollows})
}

func (s *Server) handleCopyTradeFollow(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.ID) > 500 {
		SafeBadRequest(c, "id is required")
		return
	}
	id := leadIDPattern.FindString(req.ID)
	if id == "" {
		SafeBadRequest(c, "Enter a lead trader ID or the link of their Binance copy-trading page")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	f, err := s.copyTrade.Follow(ctx, id)
	if err != nil {
		if errors.Is(err, copytrade.ErrPrivate) || strings.Contains(err.Error(), "already following") || strings.Contains(err.Error(), "at most") || strings.Contains(err.Error(), "no lead trader") {
			SafeBadRequest(c, err.Error())
			return
		}
		copyTradeError(c, err)
		return
	}
	c.JSON(http.StatusOK, f)
}

func (s *Server) handleCopyTradeFollowDetail(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	snap, ok := s.copyTrade.Snapshot(c.Param("id"))
	if !ok {
		SafeNotFound(c, "Followed trader")
		return
	}
	c.JSON(http.StatusOK, snap)
}

func (s *Server) handleCopyTradeUnfollow(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	if _, ok := s.copyTrade.Snapshot(c.Param("id")); !ok {
		SafeNotFound(c, "Followed trader")
		return
	}
	if err := s.copyTrade.Unfollow(c.Param("id")); err != nil {
		SafeInternalError(c, "Unfollow lead trader", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) handleCopyTradeFeed(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	minValue, _ := strconv.ParseFloat(c.Query("min_value"), 64)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if size < 10 || size > 200 {
		size = 50
	}
	action := c.Query("action")
	switch action {
	case "", "open", "add", "reduce", "close":
	default:
		SafeBadRequest(c, "action must be open, add, reduce or close")
		return
	}
	items, total := copytrade.FeedPage(s.copyTrade.Snapshots(), copytrade.FeedFilter{
		PortfolioID: c.Query("portfolio_id"), Symbol: c.Query("symbol"), Action: action, MinValue: minValue,
		HideHighFreq: c.Query("hide_high_freq") == "1",
		Limit:        size, Offset: (page - 1) * size,
	})
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": size})
}

func (s *Server) handleCopyTradeSymbols(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"symbols": copytrade.Symbols(s.copyTrade.Snapshots())})
}

func (s *Server) handleCopyTradeSymbol(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	symbol := strings.ToUpper(strings.TrimSpace(c.Param("symbol")))
	if !marketBoardSymbol.MatchString(symbol) {
		SafeBadRequest(c, "invalid symbol")
		return
	}
	snaps := s.copyTrade.Snapshots()
	var summary *copytrade.SymbolSummary
	for _, sum := range copytrade.Symbols(snaps) {
		if sum.Symbol == symbol {
			summary = &sum
			break
		}
	}
	// Traders' 30-day results for the chart's avatar cards, including traders
	// who have since closed this coin.
	traders := map[string]gin.H{}
	for _, sn := range snaps {
		f := sn.Follow
		traders[f.PortfolioID] = gin.H{"nickname": f.Nickname, "avatar_url": f.AvatarURL, "roi_30d": f.ROI,
			"pnl_30d": f.PnL, "win_rate_30d": f.WinRate, "score": sn.Score.Score}
	}
	c.JSON(http.StatusOK, gin.H{"symbol": symbol, "summary": summary, "holders": copytrade.Holders(snaps, symbol),
		"events": copytrade.Feed(snaps, copytrade.FeedFilter{Symbol: symbol, Limit: 500}), "traders": traders})
}

func (s *Server) handleCopyTradeHitRate(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 120 {
		SafeBadRequest(c, "days must be 1-120")
		return
	}
	rows, err := s.copyTrade.HitRates(time.Now().Add(-time.Duration(days) * 24 * time.Hour).Unix())
	if err != nil {
		SafeInternalError(c, "Copy-trade hit rate", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"days": days, "rows": rows})
}

func (s *Server) handleCopyTradeProxyGet(c *gin.Context) {
	proxy, err := s.loadCopyTradeProxy()
	if err != nil {
		SafeInternalError(c, "Read copy-trade proxy", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"proxy": copytrade.MaskProxy(proxy), "configured": proxy != ""})
}

func (s *Server) handleCopyTradeProxyPut(c *gin.Context) {
	if !s.copyTradeReady(c) {
		return
	}
	var req struct {
		Proxy string `json:"proxy"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Proxy) > 500 {
		SafeBadRequest(c, "proxy must be a URL")
		return
	}
	proxy := strings.TrimSpace(req.Proxy)
	stored := ""
	if proxy != "" {
		if _, err := copytrade.ParseProxy(proxy); err != nil {
			SafeBadRequest(c, err.Error())
			return
		}
		enc, err := s.cryptoHandler.cryptoService.EncryptForStorage(proxy, copyTradeProxyKey)
		if err != nil {
			SafeInternalError(c, "Encrypt copy-trade proxy", err)
			return
		}
		stored = enc
	}
	if err := s.store.SetSystemConfig(copyTradeProxyKey, stored); err != nil {
		SafeInternalError(c, "Save copy-trade proxy", err)
		return
	}
	if err := s.copyTrade.Client.SetProxy(proxy); err != nil {
		SafeBadRequest(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"proxy": copytrade.MaskProxy(proxy), "configured": proxy != ""})
}

// handleCopyTradeProxyTest sends one leaderboard request through the given
// proxy (or the server's own IP when empty) on a separate client, so it does
// not wait behind the monitor.
func (s *Server) handleCopyTradeProxyTest(c *gin.Context) {
	var req struct {
		Proxy string `json:"proxy"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Proxy) > 500 {
		SafeBadRequest(c, "proxy must be a URL")
		return
	}
	s.proxyTestMu.Lock()
	tooSoon := time.Since(s.proxyTestAt) < 5*time.Second
	if !tooSoon {
		s.proxyTestAt = time.Now()
	}
	s.proxyTestMu.Unlock()
	if tooSoon {
		SafeError(c, http.StatusTooManyRequests, "Wait a few seconds between tests", nil)
		return
	}
	proxy := strings.TrimSpace(req.Proxy)
	client := copytrade.NewClient()
	if err := client.SetProxy(proxy); err != nil {
		SafeBadRequest(c, err.Error())
		return
	}
	client.Spacing = 0
	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	start := time.Now()
	page, err := client.Leaderboard(ctx, copytrade.LeaderQuery{TimeRange: "30D", SortBy: "COPIER_PNL", Page: 1})
	latency := time.Since(start).Milliseconds()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error(), "latency_ms": latency})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "latency_ms": latency, "traders": page.Total})
}
