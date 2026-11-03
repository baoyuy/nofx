package store

import (
	"time"

	"gorm.io/gorm"
)

// CopyTradeFollow is a Binance lead trader on the copy-trade monitor page.
// NOFX is single-user, so follows are not split by user.
type CopyTradeFollow struct {
	PortfolioID  string  `gorm:"column:portfolio_id;primaryKey" json:"portfolio_id"`
	Nickname     string  `gorm:"column:nickname" json:"nickname"`
	AvatarURL    string  `gorm:"column:avatar_url" json:"avatar_url"`
	Status       string  `gorm:"column:status" json:"status"`
	PositionShow bool    `gorm:"column:position_show" json:"position_show"`
	AUM          float64 `gorm:"column:aum" json:"aum"`
	CopyCount    int     `gorm:"column:copy_count" json:"copy_count"`
	MaxCopyCount int     `gorm:"column:max_copy_count" json:"max_copy_count"`
	// 30-day results.
	ROI     float64 `gorm:"column:roi" json:"roi"`
	PnL     float64 `gorm:"column:pnl" json:"pnl"`
	MDD     float64 `gorm:"column:mdd" json:"mdd"`
	WinRate float64 `gorm:"column:win_rate" json:"win_rate"`

	// Fills up to this time (ms) are stored; 0 = not backfilled yet.
	FillsUntil    int64 `gorm:"column:fills_until" json:"-"`
	ProfileAt     int64 `gorm:"column:profile_at" json:"-"`
	LastTradeTime int64 `gorm:"column:last_trade_time" json:"last_trade_time"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"followed_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"-"`
}

func (CopyTradeFollow) TableName() string { return "copytrade_follows" }

// CopyTradeFill is one stored fill of a followed trader.
type CopyTradeFill struct {
	ID           int64   `gorm:"column:id;primaryKey;autoIncrement"`
	PortfolioID  string  `gorm:"column:portfolio_id;not null;index:idx_copytrade_fill,priority:1"`
	Time         int64   `gorm:"column:time;not null;index:idx_copytrade_fill,priority:2"`
	Seq          int     `gorm:"column:seq"`
	Symbol       string  `gorm:"column:symbol;not null"`
	Side         string  `gorm:"column:side"`
	PositionSide string  `gorm:"column:position_side"`
	Qty          float64 `gorm:"column:qty"`
	Price        float64 `gorm:"column:price"`
	Fee          float64 `gorm:"column:fee"`
	RealizedPnL  float64 `gorm:"column:realized_pnl"`
}

func (CopyTradeFill) TableName() string { return "copytrade_fills" }

type CopyTradeStore struct{ db *gorm.DB }

func NewCopyTradeStore(db *gorm.DB) *CopyTradeStore { return &CopyTradeStore{db: db} }

// InitTables creates the copy-trade tables (exported for tests).
func (s *CopyTradeStore) InitTables() error { return s.initTables() }

func (s *CopyTradeStore) initTables() error {
	return s.db.AutoMigrate(&CopyTradeFollow{}, &CopyTradeFill{})
}

func (s *CopyTradeStore) ListFollows() ([]CopyTradeFollow, error) {
	var out []CopyTradeFollow
	err := s.db.Order("created_at").Find(&out).Error
	return out, err
}

func (s *CopyTradeStore) GetFollow(id string) (*CopyTradeFollow, error) {
	var f CopyTradeFollow
	if err := s.db.First(&f, "portfolio_id = ?", id).Error; err != nil {
		return nil, err
	}
	return &f, nil
}

func (s *CopyTradeStore) CountFollows() (int64, error) {
	var n int64
	err := s.db.Model(&CopyTradeFollow{}).Count(&n).Error
	return n, err
}

// SaveFollow inserts or replaces a follow.
func (s *CopyTradeStore) SaveFollow(f *CopyTradeFollow) error { return s.db.Save(f).Error }

func (s *CopyTradeStore) DeleteFollow(id string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&CopyTradeFill{}, "portfolio_id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&CopyTradeFollow{}, "portfolio_id = ?", id).Error
	})
}

// Fills returns a trader's fills since sinceMs, oldest first.
func (s *CopyTradeStore) Fills(id string, sinceMs int64) ([]CopyTradeFill, error) {
	var out []CopyTradeFill
	err := s.db.Where("portfolio_id = ? AND time >= ?", id, sinceMs).Order("time, seq DESC").Find(&out).Error
	return out, err
}

// ReplaceFills swaps the fills at or after fromMs for fills, and records
// that fills up to untilMs are stored, in one transaction.
func (s *CopyTradeStore) ReplaceFills(id string, fromMs int64, fills []CopyTradeFill, untilMs int64) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&CopyTradeFill{}, "portfolio_id = ? AND time >= ?", id, fromMs).Error; err != nil {
			return err
		}
		if len(fills) > 0 {
			if err := tx.CreateInBatches(fills, 200).Error; err != nil {
				return err
			}
		}
		return tx.Model(&CopyTradeFollow{}).Where("portfolio_id = ?", id).Update("fills_until", untilMs).Error
	})
}

// PruneFills drops fills older than beforeMs.
func (s *CopyTradeStore) PruneFills(beforeMs int64) error {
	return s.db.Delete(&CopyTradeFill{}, "time < ?", beforeMs).Error
}
