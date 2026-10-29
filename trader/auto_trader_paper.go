package trader

import (
	"nofx/logger"
	"nofx/market"
	"nofx/trader/binance"
	"time"
)

// syncPaperCloses records closes the paper simulator triggered on its own
// (stop-loss, take-profit, liquidation). AI and manual closes are already
// recorded on the normal order path, so they never appear here.
func (at *AutoTrader) syncPaperCloses(pt *binance.PaperTrader, interval time.Duration, stopCh <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		at.recordPaperCloses(pt)
		select {
		case <-stopCh:
			return
		case <-ticker.C:
		}
	}
}

func (at *AutoTrader) recordPaperCloses(pt *binance.PaperTrader) {
	for _, ev := range pt.DrainCloseEvents() {
		action, positionSide := "close_long", "LONG"
		if ev.Side == "short" {
			action, positionSide = "close_short", "SHORT"
		}
		at.logInfof("📝 [Paper] %s triggered: %s %s qty=%.6f @ %.6f", ev.Reason, ev.Symbol, ev.Side, ev.Quantity, ev.ExitPrice)

		symbol := market.Normalize(ev.Symbol)
		order := at.createOrderRecord(ev.OrderID, symbol, action, positionSide, ev.Quantity, ev.ExitPrice, ev.Leverage)
		switch ev.Reason {
		case "stop_loss":
			order.Type = "STOP_MARKET"
		case "take_profit":
			order.Type = "TAKE_PROFIT_MARKET"
		case "liquidation":
			order.Type = "LIQUIDATION"
		}
		order.Status = "FILLED"
		order.FilledQuantity = ev.Quantity
		order.AvgFillPrice = ev.ExitPrice
		order.Commission = ev.Fee
		if err := at.store.Order().CreateOrder(order); err != nil {
			logger.Infof("  ⚠️ [Paper] Failed to record close order: %v", err)
		} else {
			at.recordOrderFill(order.ID, ev.OrderID, symbol, action, ev.ExitPrice, ev.Quantity, ev.Fee)
		}
		at.recordPositionChange(ev.OrderID, symbol, positionSide, action, ev.Quantity, ev.ExitPrice, ev.Leverage, ev.EntryPrice, ev.Fee)
	}
}
