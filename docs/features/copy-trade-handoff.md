# 带单（Copy-trade）功能交接文档

给接手的开发者或 agent。先读完「工作约定」再动手。

## 1. 功能是什么

监控用户在「带单」页关注的币安合约带单员，回放他们的成交，得到每个人的当前持仓和动作，再汇总成每个币的多空方向和置信度。这些数据有三个用途：

1. 「带单」页展示：发现交易员、我的关注、按币种、动态。
2. 作为策略的币源 `copy_trade`（策略页「带单币种」），选出带单员偏向明确的币交给 AI。
3. 作为任意币源的附加参考 `copy_trade_context`，在提示词里写出每个币上带单员的多空、均价、被套、新开、持仓人明细和最近动作。程序还会按 `copy_trade_follow` 强制开仓方向。

只做合约。币安的股票、商品合约（TRADIFI_PERPETUAL，如 SNDKUSDT、MUUSDT）在 binance 和 binance_paper 交易所上按币安合约交易，在其他交易所映射成 Hyperliquid 的 `xyz:SNDK`。

## 2. 数据流

```
币安 bapi (copytrade/client.go, endpoints.go)
  → Monitor 轮询 (copytrade/monitor.go)：资料每 6h，成交增量，公开持仓
  → 成交存 SQLite (store/copytrade.go)，保留 30 天
  → Replay 回放成持仓和动作 (copytrade/replay.go)
  → assessHealth 按标记价算被套/新开/强平 (copytrade/health.go)
  → Symbols 加权投票得到置信度 (copytrade/views.go, score.go)
  → api/handler_copytrade.go: copyTradeCoins() 设置 kernel.CopyTradeResolver
  → kernel/copy_trade.go: 选币、写提示词、OpenBlockReason 拦截开仓
  → trader/: 决策执行前调用 OpenBlockReason，决策记录存 CopyTrade 摘要
  → 前端看板 DecisionCopyTrade.tsx 显示 AI 看到的带单参考
```

copytrade 和 kernel 互不 import，只靠 `kernel.CopyTradeResolver` 这个函数变量连接，它在 api 层赋值。

## 3. 关键文件

| 文件 | 内容 |
|---|---|
| `copytrade/client.go` | 请求限速、代理、暂停（被限流后退避）、`checkFormat` 检测币安改格式 |
| `copytrade/endpoints.go` | 排行榜、详情、持仓、成交历史接口；`Detail.Private()` 私密账户 |
| `copytrade/monitor.go` | 轮询调度、首次回填 30 天（最多 25 页）、`Load()` 启动时从库重建、关注/取关 |
| `copytrade/replay.go` | 成交 → 持仓和动作；开在监控之前的仓位减仓记为 Untracked |
| `copytrade/health.go` | 被套（亏掉保证金 50%，杠杆未知按 10x 换算）、新开（24h 内开或加）、强平推断 |
| `copytrade/score.go` | 带单员可信度 0–100；币的置信度 = 100·一致度·人数系数·(0.5+0.5·质量)·健康度 |
| `copytrade/views.go` | `Symbols` 投票（按仓位占余额、健康度、高频降权 0.4）、`Holders`、`Feed`、`Fresh` |
| `copytrade/signals.go` | 每小时记录置信度信号，4h/24h 后算命中率；连续同向只算一次 |
| `api/handler_copytrade.go` | 所有 `/api/copytrade/*` 接口；`StartCopyTrade`；`copyTradeCoins` |
| `kernel/copy_trade.go` | 候选币、提示词文本、`copyTradeVsAvg` 追高提示、`copyTradeExitAlert` 离场提醒、`OpenBlockReason` |
| `kernel/engine_prompt.go` | 系统提示里的跟随规则、最小止损 ATR 行；候选币和持仓块里插入带单文本 |
| `market/binance_symbols.go` | `NormalizeFor(symbol, exchange)`、币安 K 线 |
| `store/strategy.go` | `CoinSourceConfig.CopyTrade*` 字段、`NormalizeCopyTrade()`、`RiskControl.MinStopATR` |
| `store/decision.go` | 决策记录的 `copy_trade` 列 |
| `web/src/components/copytrade/` | 带单页各标签页 |
| `web/src/components/strategy/CopyTradeSource.tsx` | 策略页带单币源面板、跟随/自由/反向选择 |
| `web/src/lib/strategyForm.ts` | 表单和后端配置互转，限制值和后端一致 |

`main.go` 里 `NewServer` 和 `StartCopyTrade` 必须在 `LoadTradersFromStore` 之前，否则重启后第一轮决策拿不到带单数据。

## 4. 策略配置字段（`ai_config.coin_source`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `source_type: "copy_trade"` | | 带单币源 |
| `copy_trade_min_confidence` | 40 | 置信度下限 1–100 |
| `copy_trade_direction` | both | both / long / short，只选偏向这一边的币 |
| `copy_trade_limit` | 5 | 最多几个币，1–10 |
| `copy_trade_min_traders` | 2 | 至少几人持有 |
| `copy_trade_context` | copy_trade 时恒为 true | 提示词里附带带单参考 |
| `copy_trade_follow` | copy_trade 为 follow，否则 free | follow / free / fade，程序强制 |
| `copy_trade_context_min_confidence` | 40 | 只加上下文时，跟随/反向的开仓需要的置信度 1–100（带单币源用 `copy_trade_min_confidence`） |

`risk_control.min_stop_atr`（0–5）：止损离价格小于这个倍数的主周期 ATR14 时拒绝开仓。

注意 `coin_source` 在 `ai_config` 下面，不在顶层。

## 5. 本地开发和测试

```bash
export PATH=$HOME/.local/go/bin:$PATH
go build ./... && go test ./copytrade/ ./kernel/ ./store/ ./api/ ./market/ ./trader/...
gofmt -l copytrade kernel store api market trader

cd web && npx vitest run && npm run lint && npx prettier --check "src/**/*.{ts,tsx}" && npx tsc --noEmit
```

本地后端要走代理才能访问币安：

```bash
HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 NO_PROXY=127.0.0.1,localhost ./nofx
```

调受保护接口需要 JWT：用 `.env` 里的 `JWT_SECRET` 在临时脚本里签发，放进环境变量使用，不要打印出来，用完删除脚本。

gofmt 会对齐结构体字段；新字段加在结构体中间时注意对齐，或者放到末尾。
## 6. 部署

服务器上用 docker compose 运行，代码目录 `/opt/nofx`，跟踪 `origin/dev`。登录方式向用户要，不要写进仓库。

1. 先备份数据库（每次部署前必须做）：
   ```bash
   cd /opt/nofx && stamp=$(date +%Y%m%d-%H%M%S)
   docker compose exec -T nofx sh -c "sqlite3 -cmd '.timeout 20000' /app/data/data.db \".backup /app/data/data.db.bak-$stamp-before-<说明>\""
   ```
2. 更新代码：`git fetch -q origin dev && git merge --ff-only origin/dev`
3. 构建重启：`docker compose up -d --build > /root/nofx-build.log 2>&1`
4. 检查：`docker compose ps`，以及 `docker compose logs --since 3m nofx | grep -iE "copy-trade|error"`。

服务器的 `.env` 只有 root 能读，不要输出它的内容。

## 7. 现状（2026-11-05）

- 服务器上有一个用「带单」策略的交易员，在 binance_paper 模拟盘运行。设置：1h + 4h K 线各 30 根（30 是 `MaxKlineCount` 上限），最多 4 个仓位，保证金最多用 50%，盈亏比不低于 2，置信度不低于 70，止损至少 1.5 ATR，跟随模式。
- 当前持有 MU 多单，按旧设置开的，仓位价值约是账户的 3 倍。
- 关注的账户里有 8 个是私密账户，不贡献任何数据。「改为关注公域」的单账户按钮前端已有（`FollowingTab.tsx` 的 `followPublic`），剩下的是批量处理老关注。

## 8. 已知问题和待办

按建议顺序。用户还没确认要做的，动手前先问。

**第一批已修（数据可用性 + 回放与权重）**
- 带单数据断了或只有部分账户新鲜时，不再写成"没人持有这个币"：`kernel.CopyTradeResolver` 现在返回 `CopyTradeView{Coins, Fresh, Total, Reason}`，`api.copyTradeView` 用 30 分钟新鲜度和「非私密关注数」算出覆盖率，`formatCopyTrade` 分「完全没数据 / 部分陈旧 / 完整」三种写法，`Context.CopyTradeCoverage` 带给提示词。数据不完整时不发离场提醒，也不给出候选币（`copyTradeCandidates`）。
- 回填窗口之前开的仓：`Monitor.rebuild` 用「Binance 公开持仓量 > 回放累计量」判断该仓早于成交记录（`preOpenedBooks`），再用 `ReplayKnown` 把第一次见到的同向成交标成 `add`、`OpenedAt=0`、`Position.PreExisting=true`，不再当新开仓。
- 被套按「均价与首次开仓价里更差的那个」判断（`Position.firstEntryMarginLoss`），摊平后不会再从"被套"里消失；同时给 `Position` 增加了 `FirstEntry`。
- 加仓到已亏损仓位不再拿「新开 ×1.3」的加成（`healthFactor` 里 `p.Fresh && !p.Trapped`）。
- 离场提醒阈值改成「离场人数 ≥ 同方向人数的 1/3」（`exitAlertShare`），不再是 1 个人减仓就提醒。

**第二批已修（门槛、说明、迁移、预览）**
- 跟随/反向模式原来只看方向：非带单币源加上下文时，1 个人、置信度 5 也能开仓。现在 `OpenBlockReason` 会检查置信度，带单币源用 `copy_trade_min_confidence`，只加上下文时用新字段 `copy_trade_context_min_confidence`（默认 40），策略页在选了跟随/反向时显示这个输入框，系统提示词也会写出这个门槛。
- `api/server.go` 给 AI 的策略说明补上了 `copy_trade_follow` 和 `copy_trade_context_min_confidence`，`primary_count` 改回真实的 10–30。
- PostgreSQL：`decision_records` 表已存在时会手动补 `copy_trade` 列，不再整条决策记录插入失败。
- `/copytrade/symbols?fresh=1` 只返回 30 分钟内刷新过的带单员数据，策略页「当前会交易」用它，并在只有部分账户新鲜时提示实际可选币可能更少。

**待做：带单员风格（用户提出的问题）**
带单员有短线、波段、长线，还有亏了不断加仓的摊平型。计划：
- 用 30 天成交回放每笔完整交易，算平均持仓时间、逆势加仓比例、每笔加仓次数、亏损离场占比，然后分类：短线 <4h，波段 4h–3d，长线 >3d，摊平型，样本不足（<5 笔），未知（私密账户）。
- 按策略主周期给风格加权：1h/4h 策略里波段满权重，短线和长线降权。持仓时间目前还不影响权重。
- 摊平型默认 0.3 票（现在只是不给新开加成，还没有单独的降权系数）。
- 持仓人明细、我的关注都显示风格标签，能按风格筛选。
- 策略页可以选参考哪些风格。
- 注意成本：请求是全局 4s 一次串行，一个人回填 30 天最多 25 页 ≈100s，所以「发现交易员」列表里的风格标签不能对所有人预先算，只能按需或只算已关注的人。

**其他**
- 推断仓位假设 10 倍杠杆：杠杆未知时被套按 5% 价格折算，可能不准，提示词里还没写"杠杆未知"。
- 私密账户批量换成公开账户，没有公开账户的取消关注；老关注重新回填到 30 天（把 `FillsUntil` 置 0 会触发回填，每个账户最多 25 页请求）。

## 9. 工作约定

- 用中文回复用户。用户说"先回答我"时，只解释，不改代码。
- 每个改动都提交并推送到 `origin/dev`。提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。git 身份和 SSH key 只在这个仓库里配置，不要改全局配置。
- 不要提交 `.env`、`data/`、`nofx` 二进制文件。
- 不要下真实订单。验证用 binance_paper 模拟盘。
- 用户要求时才部署，部署前先备份数据库。
- 币安限流时退避，不要绕过它的反爬机制，也不要自己额外发请求去探测。
- 改表单限制值时，前端 `strategyForm.ts` 的 `LIMITS` 和后端 `ClampLimits` 一起改。
- 测试：`copytrade/*_test.go`、`kernel/copy_trade_test.go`、`web/src/components/strategy/CopyTradeSource.test.ts`、`web/src/components/copytrade/*.test.ts`。
