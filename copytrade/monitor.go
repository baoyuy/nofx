package copytrade

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"nofx/logger"
	"nofx/store"
)

const (
	// MaxFollows bounds the followed traders so one refresh round stays a few
	// minutes at the request spacing.
	MaxFollows = 100

	backfillWindow  = 7 * 24 * time.Hour
	retention       = 30 * 24 * time.Hour
	maxPagesPerSync = 10
	hotInterval     = time.Minute
	coldInterval    = 15 * time.Minute
	errorInterval   = 5 * time.Minute
	profileInterval = 6 * time.Hour
	hotWindow       = 2 * time.Hour
	maxEventsKept   = 300
	// profileVersion bumps when the stored profile gains fields, so older
	// profiles are fetched again once (2 = start time and balance, 3 =
	// portfolio type).
	profileVersion = 3
)

// Snapshot is the rebuilt view of one followed trader.
type Snapshot struct {
	Follow    store.CopyTradeFollow `json:"trader"`
	Positions []Position            `json:"positions"`
	// Events are newest first.
	Events []Event `json:"events"`
	// PositionsSource: "public" when Binance shows the positions, else
	// "inferred" from fills since monitoring started.
	PositionsSource string      `json:"positions_source"`
	UpdatedAt       time.Time   `json:"updated_at"`
	Error           string      `json:"error,omitempty"`
	Hot             bool        `json:"hot"`
	Score           TraderScore `json:"score"`

	nextDue time.Time
}

// Monitor polls followed traders in the background.
type Monitor struct {
	Client *Client
	// Bars prices the hourly confidence signals; nil disables them.
	Bars BarsFunc
	// Marks prices held positions; nil leaves inferred positions unpriced.
	Marks MarksFunc
	store *store.CopyTradeStore

	markMu sync.RWMutex
	marks  map[string]float64

	mu    sync.RWMutex
	snaps map[string]*Snapshot
	wake  chan struct{}

	boardMu sync.Mutex
	boards  map[string]cachedBoard
}

type cachedBoard struct {
	at   time.Time
	page LeaderPage
}

func NewMonitor(st *store.CopyTradeStore) *Monitor {
	return &Monitor{Client: NewClient(), store: st, snaps: map[string]*Snapshot{},
		wake: make(chan struct{}, 1), boards: map[string]cachedBoard{}}
}

// Run loads stored follows, then refreshes the most overdue trader one at a
// time until ctx ends.
func (m *Monitor) Run(ctx context.Context) {
	follows, err := m.store.ListFollows()
	if err != nil {
		logger.Warnf("copy-trade: load follows: %v", err)
	}
	now := time.Now()
	for i, f := range follows {
		snap := &Snapshot{Follow: f, nextDue: now.Add(time.Duration(i) * 2 * time.Second)}
		m.rebuild(snap, nil)
		m.mu.Lock()
		m.snaps[f.PortfolioID] = snap
		m.mu.Unlock()
	}
	go m.signalLoop(ctx)
	go m.markLoop(ctx)
	prune := time.NewTicker(time.Hour)
	defer prune.Stop()
	for {
		id, due := m.nextDue()
		wait := time.Until(due)
		if id == "" {
			wait = time.Hour
		}
		timer := time.NewTimer(max(wait, 0))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-m.wake:
			timer.Stop()
			continue
		case <-prune.C:
			timer.Stop()
			if err := m.store.PruneFills(time.Now().Add(-retention).UnixMilli()); err != nil {
				logger.Warnf("copy-trade: prune fills: %v", err)
			}
			continue
		case <-timer.C:
		}
		if id != "" {
			m.refresh(ctx, id)
		}
	}
}

func (m *Monitor) nextDue() (string, time.Time) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var id string
	var due time.Time
	for k, s := range m.snaps {
		if id == "" || s.nextDue.Before(due) {
			id, due = k, s.nextDue
		}
	}
	return id, due
}

func (m *Monitor) poke() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

// refresh syncs one trader: profile every few hours, new fills, and public
// positions when shown.
func (m *Monitor) refresh(ctx context.Context, id string) {
	m.mu.RLock()
	snap, ok := m.snaps[id]
	m.mu.RUnlock()
	if !ok {
		return
	}
	f := snap.Follow
	err := m.syncProfile(ctx, &f)
	// Private portfolios return no trades: only the profile is kept fresh.
	if err == nil && !f.Private {
		err = m.syncFills(ctx, &f)
	}
	var live []LivePosition
	if err == nil && f.PositionShow && !f.Private {
		live, err = m.Client.Positions(ctx, id)
	}
	retry := time.Now().Add(errorInterval)
	if errors.Is(err, ErrPaused) {
		// Status waits for the request gate, so read it before taking m.mu.
		retry = time.Now().Add(time.Minute)
		if until := m.Client.Status().PausedUntil; until.After(retry) {
			retry = until
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.snaps[id]
	if !ok {
		return // unfollowed meanwhile
	}
	cur.Follow = f
	if err != nil {
		cur.Error = err.Error()
		cur.nextDue = retry
		return
	}
	cur.Error = ""
	m.rebuild(cur, live)
	cur.UpdatedAt = time.Now()
	cur.nextDue = time.Now().Add(coldInterval)
	if cur.Hot {
		cur.nextDue = time.Now().Add(hotInterval)
	}
}

func (m *Monitor) syncProfile(ctx context.Context, f *store.CopyTradeFollow) error {
	if time.Since(time.UnixMilli(f.ProfileAt)) < profileInterval && f.ProfileVersion >= profileVersion {
		return nil
	}
	d, err := m.Client.Detail(ctx, f.PortfolioID)
	if err != nil {
		return err
	}
	applyDetail(f, d)
	perf, err := m.Client.Performance(ctx, f.PortfolioID, "30D")
	if err != nil {
		return err
	}
	f.ROI, f.PnL, f.MDD, f.WinRate = float64(perf.ROI), float64(perf.PnL), float64(perf.MDD), float64(perf.WinRate)
	f.ProfileAt, f.ProfileVersion = time.Now().UnixMilli(), profileVersion
	return m.store.SaveFollow(f)
}

func applyDetail(f *store.CopyTradeFollow, d Detail) {
	f.Nickname, f.AvatarURL, f.Status, f.PositionShow = d.Nickname, d.AvatarURL, d.Status, d.PositionShow
	f.AUM, f.CopyCount, f.MaxCopyCount = float64(d.AUM), d.CopyCount, d.MaxCopyCount
	f.MarginBalance, f.StartTime = float64(d.MarginBalance), d.StartTime
	f.Private, f.PublicID = d.Private(), d.PublicID
	if f.PublicID == f.PortfolioID {
		f.PublicID = ""
	}
	if d.LastTradeTime > 0 {
		f.LastTradeTime = d.LastTradeTime
	}
}

// syncFills fetches fills newer than the stored ones (or the last 7 days on
// the first run). Pages are newest first and fills have no ID, so it stores
// the fetched window as a whole: every fill at or after the oldest fully
// fetched time replaces what was stored there.
func (m *Monitor) syncFills(ctx context.Context, f *store.CopyTradeFollow) error {
	stop := f.FillsUntil
	if stop == 0 {
		stop = time.Now().Add(-backfillWindow).UnixMilli()
	}
	var rows []Trade
	reachedEnd := false
	for page := 1; page <= maxPagesPerSync; page++ {
		p, err := m.Client.Trades(ctx, f.PortfolioID, page, TradePageSize)
		if err != nil {
			return err
		}
		rows = append(rows, p.List...)
		if len(p.List) < TradePageSize {
			reachedEnd = true
			break
		}
		if p.List[len(p.List)-1].Time < stop {
			break
		}
	}
	from, until := stop, stop
	if len(rows) > 0 {
		until = max(until, rows[0].Time)
		oldest := rows[len(rows)-1].Time
		if !reachedEnd && oldest >= stop {
			// The page cap hit before the stored range: keep only fully
			// fetched times and note the gap.
			from = oldest + 1
			logger.Warnf("copy-trade: %s traded more than %d fills since the last check; older ones skipped",
				f.PortfolioID, maxPagesPerSync*TradePageSize)
		}
	}
	fills := make([]store.CopyTradeFill, 0, len(rows))
	for i, t := range rows {
		if t.Time < from {
			continue
		}
		fills = append(fills, store.CopyTradeFill{PortfolioID: f.PortfolioID, Time: t.Time, Seq: i,
			Symbol: strings.ToUpper(t.Symbol), Side: strings.ToUpper(t.Side), PositionSide: strings.ToUpper(t.PositionSide),
			Qty: float64(t.Qty), Price: float64(t.Price), Fee: float64(t.Fee), RealizedPnL: float64(t.RealizedPnL)})
	}
	if len(rows) > 0 {
		f.LastTradeTime = max(f.LastTradeTime, rows[0].Time)
	}
	if err := m.store.ReplaceFills(f.PortfolioID, from, fills, until); err != nil {
		return err
	}
	f.FillsUntil = until
	return nil
}

// rebuild recomputes positions and events from stored fills. Caller holds
// m.mu for snapshots already in m.snaps.
func (m *Monitor) rebuild(s *Snapshot, live []LivePosition) {
	stored, err := m.store.Fills(s.Follow.PortfolioID, time.Now().Add(-retention).UnixMilli())
	if err != nil {
		s.Error = err.Error()
		return
	}
	fills := make([]Fill, len(stored))
	for i, f := range stored {
		fills[i] = Fill{Time: f.Time, Seq: f.Seq, Symbol: f.Symbol, Side: f.Side, PositionSide: f.PositionSide,
			Qty: f.Qty, Price: f.Price, Fee: f.Fee, RealizedPnL: f.RealizedPnL}
	}
	positions, events := Replay(fills)
	s.PositionsSource = "inferred"
	if s.Follow.PositionShow && live != nil {
		positions, s.PositionsSource = LivePositions(live, positions), "public"
	}
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}
	if len(events) > maxEventsKept {
		events = events[:maxEventsKept]
	}
	s.Positions, s.Events = positions, events
	s.Hot = len(positions) > 0 || time.Since(time.UnixMilli(s.Follow.LastTradeTime)) < hotWindow
	if s.Follow.Private {
		s.Hot = false // nothing to poll
	}
}

// Follow adds a trader after checking it exists. Its history is fetched in
// the background.
func (m *Monitor) Follow(ctx context.Context, id string) (*store.CopyTradeFollow, error) {
	if err := m.canFollow(id); err != nil {
		return nil, err
	}
	d, err := m.Client.Detail(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.PortfolioID == "" && d.Nickname == "" {
		return nil, errors.New("no lead trader with this ID")
	}
	if d.Private() {
		// Its trades are hidden; the same trader's public portfolio shows them.
		if d.PublicID == "" || d.PublicID == id {
			return nil, ErrPrivate
		}
		id = d.PublicID
		if err := m.canFollow(id); err != nil {
			return nil, err
		}
		if d, err = m.Client.Detail(ctx, id); err != nil {
			return nil, err
		}
		if d.Private() {
			return nil, ErrPrivate
		}
	}
	f := store.CopyTradeFollow{PortfolioID: id}
	applyDetail(&f, d)
	if err := m.store.SaveFollow(&f); err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.snaps[id] = &Snapshot{Follow: f, PositionsSource: "inferred", nextDue: time.Now()}
	m.mu.Unlock()
	m.poke()
	return &f, nil
}

// ErrPrivate refuses a private portfolio with no public one to follow.
var ErrPrivate = errors.New("this is a private copy-trading portfolio: Binance hides its trades and positions, and the trader has no public portfolio to follow instead")

func (m *Monitor) canFollow(id string) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, exists := m.snaps[id]; exists {
		return errors.New("already following this trader")
	}
	if len(m.snaps) >= MaxFollows {
		return fmt.Errorf("you can follow at most %d traders", MaxFollows)
	}
	return nil
}

func (m *Monitor) Unfollow(id string) error {
	if err := m.store.DeleteFollow(id); err != nil {
		return err
	}
	m.mu.Lock()
	delete(m.snaps, id)
	m.mu.Unlock()
	m.poke()
	return nil
}

// Snapshots returns copies of every followed trader's view, newest follow last.
func (m *Monitor) Snapshots() []Snapshot {
	m.mu.RLock()
	out := make([]Snapshot, 0, len(m.snaps))
	now := time.Now()
	marks := m.currentMarks()
	for _, s := range m.snaps {
		out = append(out, m.view(s, marks, now))
	}
	m.mu.RUnlock()
	sort.Slice(out, func(a, b int) bool { return out[a].Follow.CreatedAt.Before(out[b].Follow.CreatedAt) })
	return out
}

func (m *Monitor) Snapshot(id string) (Snapshot, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.snaps[id]
	if !ok {
		return Snapshot{}, false
	}
	return m.view(s, m.currentMarks(), time.Now()), true
}

// view copies a snapshot with its score and position health.
func (m *Monitor) view(s *Snapshot, marks map[string]float64, now time.Time) Snapshot {
	snap := *s
	snap.Score = ScoreTrader(snap.Follow, now)
	snap.Positions = assessHealth(s.Positions, marks, snap.Follow.MarginBalance, now)
	return snap
}

// Leaderboard serves Binance's leaderboard, cached for 10 minutes per query.
func (m *Monitor) Leaderboard(ctx context.Context, q LeaderQuery) (LeaderPage, error) {
	key := fmt.Sprintf("%s|%s|%d|%s", q.TimeRange, q.SortBy, q.Page, q.Nickname)
	m.boardMu.Lock()
	hit, ok := m.boards[key]
	m.boardMu.Unlock()
	if ok && time.Since(hit.at) < 10*time.Minute {
		return hit.page, nil
	}
	page, err := m.Client.Leaderboard(ctx, q)
	if err != nil {
		return LeaderPage{}, err
	}
	m.boardMu.Lock()
	if len(m.boards) > 200 {
		m.boards = map[string]cachedBoard{}
	}
	m.boards[key] = cachedBoard{at: time.Now(), page: page}
	m.boardMu.Unlock()
	return page, nil
}
