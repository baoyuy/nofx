import {
  BookOpen,
  GitBranch,
  Monitor,
  Shield,
  TrendingUp,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * FAQ content model. Answers are composed from typed blocks so the renderer
 * stays generic — no per-question JSX special cases. Inline `code` spans are
 * written with backticks and parsed by the renderer.
 */
export type FAQBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'steps'; items: string[] }
  | { type: 'note'; text: string }
  | { type: 'links'; links: { label: string; href: string }[] }

export interface FAQItem {
  id: string
  question: string
  blocks: FAQBlock[]
}

export interface FAQCategory {
  id: string
  title: string
  icon: LucideIcon
  items: FAQItem[]
}

/** Plain text of an item, used by the search filter. */
export function faqItemSearchText(item: FAQItem): string {
  const parts: string[] = [item.question]
  for (const block of item.blocks) {
    if (block.type === 'p' || block.type === 'note') parts.push(block.text)
    else if (block.type === 'list' || block.type === 'steps')
      parts.push(block.items.join(' '))
    else if (block.type === 'links')
      parts.push(block.links.map((l) => l.label).join(' '))
  }
  return parts.join(' ').toLowerCase()
}

export const faqCategories: FAQCategory[] = [
  // ───────────────────────── Getting started ─────────────────────────
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: BookOpen,
    items: [
      {
        id: 'what-is-nofx',
        question: 'What is NOFX?',
        blocks: [
          {
            type: 'p',
            text: 'NOFX is an open-source, self-hosted AI trading terminal. Its flagship mode is the NOFX Autopilot: an AI agent that reads the Claw402.ai signal board, verifies candidates with Signal Lab and liquidation structure, confirms timing with raw candles, and executes on Hyperliquid — all on your own machine, with your keys never leaving your server.',
          },
          {
            type: 'p',
            text: 'Beyond the Autopilot you can build custom strategies in Strategy Studio, run multiple AI traders side by side, and compare them on the leaderboard.',
          },
        ],
      },
      {
        id: 'what-do-i-need',
        question: 'What do I need before launching the Autopilot?',
        blocks: [
          {
            type: 'p',
            text: 'Two funded accounts — the guided launch on the Config page walks you through both:',
          },
          {
            type: 'list',
            items: [
              'An AI fee wallet: a Base-chain USDC wallet that pays for AI model and market-data calls. Minimum `1 USDC` to launch.',
              'A Hyperliquid account with trading authorization and at least `12 USDC` available as margin.',
            ],
          },
          {
            type: 'p',
            text: 'The launch button runs a server-side preflight that checks every prerequisite and points you at the exact step that is missing, so you cannot start a half-configured bot.',
          },
        ],
      },
      {
        id: 'which-markets',
        question: 'Which markets can it trade?',
        blocks: [
          {
            type: 'p',
            text: 'The Autopilot trades Hyperliquid perpetuals: crypto majors (BTC, ETH, SOL, …) plus the xyz synthetic markets covering US stocks, indices, commodities, and FX — so one account gives the AI a multi-asset universe.',
          },
          {
            type: 'p',
            text: 'Manual traders built in Strategy Studio can also connect Binance, Bybit, OKX, Bitget, KuCoin, Gate, Aster, and Lighter.',
          },
        ],
      },
      {
        id: 'ai-models',
        question: 'Which AI models does it use? Do I need API keys?',
        blocks: [
          {
            type: 'p',
            text: 'No API keys are required. NOFX routes inference through Claw402 pay-as-you-go infrastructure: your AI fee wallet pays per call with Base USDC, and the terminal accesses supported models (DeepSeek and other frontier models) on demand.',
          },
          {
            type: 'p',
            text: 'Power users can still plug in their own provider keys (OpenAI, Claude, Gemini, DeepSeek, Qwen, Grok, Kimi, or any OpenAI-compatible endpoint) under Config → Models.',
          },
        ],
      },
      {
        id: 'is-it-profitable',
        question: 'Will it make money?',
        blocks: [
          {
            type: 'p',
            text: 'No one can promise that, and you should distrust anyone who does. The AI trades a systematic process, but markets are adversarial and past performance never guarantees future results.',
          },
          {
            type: 'p',
            text: 'The dashboard is deliberately honest about performance: it separates realized from unrealized P/L, shows the fee-drag chain (gross − fees = net), profit factor, and max drawdown computed from your real starting balance. Watch those numbers, start small, and only trade money you can afford to lose.',
          },
          {
            type: 'note',
            text: 'Trading involves substantial risk of loss. NOFX is software, not investment advice.',
          },
        ],
      },
    ],
  },

  // ───────────────────────── Launch & wallets ─────────────────────────
  {
    id: 'launch-wallets',
    title: 'Launch & Wallets',
    icon: Zap,
    items: [
      {
        id: 'ai-fee-wallet',
        question: 'What is the AI fee wallet?',
        blocks: [
          {
            type: 'p',
            text: 'A dedicated EVM wallet on Base that pays for AI model calls and paid market data (x402 micropayments). It is completely separate from your trading collateral — it never touches Hyperliquid.',
          },
          {
            type: 'list',
            items: [
              'The guided setup creates it for you (or reuses an existing one).',
              'Deposit only USDC on the Base network to its address.',
              'Launch requires at least `1 USDC`; the balance display refreshes automatically after a deposit.',
              'A typical cycle costs a fraction of a cent to a few cents depending on the model.',
            ],
          },
        ],
      },
      {
        id: 'fee-wallet-private-key',
        question: 'Where is the AI fee wallet private key kept?',
        blocks: [
          {
            type: 'p',
            text: 'The key is generated locally on your server, stored encrypted (AES-256) in your own database, and shown to you once in the onboarding screen. Back it up — it cannot be recovered if you lose your database.',
          },
          {
            type: 'note',
            text: 'Keep only fee money in this wallet. It exists to pay for AI calls, not to hold savings.',
          },
        ],
      },
      {
        id: 'hyperliquid-authorization',
        question: 'How does the Hyperliquid authorization work? Is it safe?',
        blocks: [
          {
            type: 'p',
            text: 'NOFX uses Hyperliquid agent wallets, so your main wallet key is never shared. The connect flow has four signed steps:',
          },
          {
            type: 'steps',
            items: [
              'Connect your EVM wallet (Rabby, MetaMask, OKX, Coinbase Wallet).',
              'Approve a freshly generated NOFX agent wallet — valid for 180 days, trading only.',
              'Approve the builder fee (a small per-order fee that funds the platform).',
              'Save the agent key to your NOFX server (stored encrypted).',
            ],
          },
          {
            type: 'p',
            text: 'The agent wallet can place and close orders, nothing else. It cannot withdraw funds, and your collateral stays inside your own Hyperliquid account at all times.',
          },
        ],
      },
      {
        id: 'launch-preflight',
        question: 'What does the launch preflight check?',
        blocks: [
          {
            type: 'p',
            text: 'Before anything is created or changed, the server verifies the full chain with live data:',
          },
          {
            type: 'list',
            items: [
              'AI model is enabled and has a credential.',
              'AI fee wallet key is valid and the Base USDC balance is at least `1 USDC` (queried on-chain).',
              'Hyperliquid account is authorized (agent + builder fee) and reachable.',
              'Trading funds: at least `12 USDC` counting equity in open positions.',
            ],
          },
          {
            type: 'p',
            text: 'Each failing check names the exact fix and deep-links into the guided setup. The same checks are enforced server-side on every start, so the UI cannot be bypassed accidentally.',
          },
        ],
      },
      {
        id: 'relaunch-behavior',
        question: 'What happens if I press Launch again?',
        blocks: [
          {
            type: 'p',
            text: 'Launching is idempotent. If a NOFX Autopilot already exists, the launcher updates it with the current strategy config and restarts it — it never creates a duplicate. A restart can take up to a minute if the bot is mid-cycle; the UI waits for it.',
          },
        ],
      },
      {
        id: 'deposit-not-showing',
        question: 'I deposited USDC but the balance still shows zero.',
        blocks: [
          {
            type: 'list',
            items: [
              'AI fee wallet: make sure you sent USDC on the Base network to the exact address shown. Balances are cached for ~30 seconds, and the setup panel re-checks automatically every few seconds.',
              'Hyperliquid: deposits land in your own Hyperliquid account; the balance step polls the live account state. Use Refresh in the guided panel if in doubt.',
              'If the on-chain RPC is temporarily unreachable, the panel marks the balance as unknown instead of zero — retry in a minute.',
            ],
          },
        ],
      },
    ],
  },

  // ───────────────────────── Trading & execution ─────────────────────────
  {
    id: 'trading',
    title: 'Trading & Execution',
    icon: TrendingUp,
    items: [
      {
        id: 'autopilot-pipeline',
        question: 'How does the Autopilot strategy work, step by step?',
        blocks: [
          {
            type: 'p',
            text: 'Every cycle runs the same four-stage funnel — each stage can reject a candidate, and only setups that survive all four get traded:',
          },
          {
            type: 'steps',
            items: [
              'Build the universe — pull the live Claw402.ai ranking and take the top candidates (default 10) across crypto majors and the xyz synthetic markets (US stocks, indices, commodities, FX), each with a direction bias and signal z-score.',
              'Verify each candidate — fetch its Signal Lab deep signal plus the cost/liquidation structure around price: liquidation clusters and cost bases show whether a move has fuel ahead of it or walls against it.',
              'Confirm timing — read the raw 15-minute OHLCV candles (30 bars) to check the entry is riding structure, not chasing an extended move.',
              'Decide and size — only setups clearing the confidence threshold (default `78/100`) with roughly `3:1` risk/reward get positions at 10x; closes always execute before opens, and both long and short books are considered every cycle.',
            ],
          },
          {
            type: 'p',
            text: 'A fifth layer sits outside the AI entirely: hard risk controls (position cap, leverage caps, margin ceiling, trade throttle) reject any decision that violates them, no matter how confident the model is.',
          },
        ],
      },
      {
        id: 'data-sources',
        question: 'What data does it use, and which parts are paid?',
        blocks: [
          {
            type: 'list',
            items: [
              'Claw402.ai signal data — the ranking board, per-symbol Signal Lab deep signals, and market net-flow. These are paid endpoints, billed per call in USDC from your AI fee wallet (x402 micropayments).',
              'Cost/liquidation heatmaps — aggregated position-cost and liquidation-cluster structure for each market.',
              'Hyperliquid market data — raw OHLCV candles and the live L2 order book (free public data).',
              'Your account via the agent wallet — equity, available margin, open positions with PnL.',
              'Its own history — closed trades feed win rate, profit factor and drawdown back into the next prompt, so the AI knows its recent form.',
            ],
          },
          {
            type: 'note',
            text: 'The dashboard polls the paid Claw402 endpoints slowly (every few minutes) to conserve your fee wallet — market-data panels stay live from the free feeds.',
          },
        ],
      },
      {
        id: 'decision-cycle',
        question: 'How often does the AI make decisions?',
        blocks: [
          {
            type: 'p',
            text: 'The Autopilot runs a scan cycle every 5–15 minutes depending on how you launched it (configurable per trader, minimum 3 minutes). The first cycle starts right after launch; a single cycle usually takes 30–60 seconds because the AI reads the full market context before deciding.',
          },
        ],
      },
      {
        id: 'what-ai-sees',
        question: 'What information does the AI see each cycle?',
        blocks: [
          {
            type: 'list',
            items: [
              'Your account: equity, available margin, open positions with PnL.',
              'The Claw402 ranking board: candidate universe with direction bias.',
              'Signal Lab deep signals and cost/liquidation structure per candidate.',
              'Raw OHLCV candles for timing confirmation.',
              'Its own track record: win rate, profit factor, drawdown, recent trades.',
            ],
          },
          {
            type: 'p',
            text: 'Every cycle is stored as a decision record — the Execution Log on the dashboard shows the reasoning chain, actions, and any blocked orders.',
          },
        ],
      },
      {
        id: 'leverage-and-risk',
        question: 'What leverage and risk controls does it use?',
        blocks: [
          {
            type: 'p',
            text: 'The Autopilot defaults to 10x cross margin. Hard risk controls run outside the AI and cannot be overridden by it:',
          },
          {
            type: 'list',
            items: [
              'Position-count cap from the strategy config — new opens are rejected at the cap.',
              'Leverage limits per asset class (BTC/ETH vs altcoins).',
              'A trade throttle blocks churn, e.g. closing a barely-moved position minutes after opening it.',
              'Safe mode (below) protects the book when the AI itself is failing.',
            ],
          },
        ],
      },
      {
        id: 'safe-mode',
        question: 'What is safe mode?',
        blocks: [
          {
            type: 'p',
            text: 'If the AI fails 3 cycles in a row (provider outage, empty fee wallet, bad responses), the trader enters safe mode: no new positions are opened, existing positions keep their protection, and the loop keeps retrying. It exits safe mode automatically on the next successful AI call.',
          },
          {
            type: 'p',
            text: 'Safe mode is shown as a banner on the dashboard together with the reason, so it never happens silently.',
          },
        ],
      },
      {
        id: 'fee-wallet-empty-mid-run',
        question: 'What happens if the AI fee wallet runs out mid-run?',
        blocks: [
          {
            type: 'p',
            text: 'AI calls start failing with a clear "out of funds" status. The dashboard shows a persistent red banner with the wallet balance, and after three failed cycles the bot enters safe mode. Top up Base USDC to the fee wallet and the trader recovers on its own — no restart needed.',
          },
        ],
      },
      {
        id: 'trading-fees',
        question: 'What fees am I paying?',
        blocks: [
          {
            type: 'list',
            items: [
              'Hyperliquid trading fees on every order, plus the approved builder fee.',
              'AI/data costs paid per call from the fee wallet (cents per cycle).',
            ],
          },
          {
            type: 'p',
            text: 'Fees are the silent killer of high-frequency strategies. The dashboard stats strip shows the full chain — gross realized P/L, minus fees, equals net — so you can see immediately whether fees are eating the edge.',
          },
        ],
      },
      {
        id: 'stop-and-manual',
        question: 'How do I stop the bot or close positions manually?',
        blocks: [
          {
            type: 'list',
            items: [
              'Stop: use the Stop button on the Config page trader list. Stopping halts the decision loop; open positions remain open and are yours to manage.',
              'Manual close: close any position from the dashboard positions panel — manual closes sync back into the position history.',
              'Emergencies: you can always manage positions directly on Hyperliquid; NOFX never locks you out of your own account.',
            ],
          },
        ],
      },
    ],
  },

  // ───────────────────────── Dashboard & metrics ─────────────────────────
  {
    id: 'dashboard',
    title: 'Dashboard & Metrics',
    icon: Monitor,
    items: [
      {
        id: 'metrics-meaning',
        question: 'What do the header metrics mean exactly?',
        blocks: [
          {
            type: 'list',
            items: [
              'Equity — live account value including unrealized PnL.',
              'Total P/L (incl. unrealized) — equity versus your starting balance; moves with open positions.',
              'Realized P/L (closed trades) — net result of finished trades only; this is what win rate, profit factor and sharpe are computed from.',
              'Profit factor — gross wins ÷ gross losses on closed trades; above 1.0 means the closed book is net positive.',
              'Max drawdown — worst peak-to-trough dip of the realized equity curve, measured against your real starting balance.',
            ],
          },
        ],
      },
      {
        id: 'pl-contradiction',
        question: 'Why is Total P/L positive while Realized P/L is negative?',
        blocks: [
          {
            type: 'p',
            text: 'They measure different things. Realized P/L only counts closed trades; Total P/L also includes the unrealized gains of positions still open. A bot can be down on its closed trades while its open book carries enough unrealized profit to put total P/L in the green — and vice versa. Check the gross/fees/net strip to see how much of the realized result is fee drag.',
          },
        ],
      },
      {
        id: 'execution-log',
        question: 'Where can I see why the AI did (or refused) something?',
        blocks: [
          {
            type: 'p',
            text: 'The Execution Log panel lists every cycle with the actions taken, the AI call duration, and any blocked orders with the exact guard that fired (throttle, position cap, risk control). Full reasoning chains are stored with each decision record.',
          },
        ],
      },
      {
        id: 'competition',
        question: 'What is the leaderboard / competition?',
        blocks: [
          {
            type: 'p',
            text: 'Traders with "show in competition" enabled appear on the public leaderboard, ranked by live performance. It is opt-in per trader and can be toggled from the trader list at any time.',
          },
        ],
      },
    ],
  },

  // ───────────────────────── Security ─────────────────────────
  {
    id: 'security',
    title: 'Security',
    icon: Shield,
    items: [
      {
        id: 'key-storage',
        question: 'How are my keys stored?',
        blocks: [
          {
            type: 'list',
            items: [
              'All secrets (agent keys, fee wallet key, exchange API keys) are AES-256 encrypted at rest in your own database.',
              'Optional RSA transport encryption protects secrets in flight between browser and server.',
              'NOFX is self-hosted: nothing is sent to any third-party server. The code is open source and auditable.',
            ],
          },
        ],
      },
      {
        id: 'can-nofx-steal-funds',
        question: 'Can NOFX withdraw or steal my funds?',
        blocks: [
          {
            type: 'p',
            text: 'No. On Hyperliquid, NOFX only ever holds an agent wallet, which by protocol design can trade but cannot withdraw. Your collateral stays in your own account under your main wallet’s control.',
          },
          {
            type: 'note',
            text: 'If you connect a CEX instead, create its API key with trading permission only — disable withdrawals and set an IP whitelist.',
          },
        ],
      },
      {
        id: 'registration-model',
        question: 'Why can’t anyone else register on my instance?',
        blocks: [
          {
            type: 'p',
            text: 'By design, an instance is single-operator: the first account registered becomes the operator and registration closes ("System already initialized"). This prevents strangers from creating accounts on an exposed deployment. Run one instance per operator.',
          },
        ],
      },
    ],
  },

  // ───────────────────────── Self-hosting ─────────────────────────
  {
    id: 'self-hosting',
    title: 'Self-Hosting & Troubleshooting',
    icon: Wrench,
    items: [
      {
        id: 'how-to-install',
        question: 'How do I install NOFX?',
        blocks: [
          {
            type: 'p',
            text: 'One line on Linux/macOS (installs and starts everything via Docker):',
          },
          {
            type: 'list',
            items: [
              'Script: `curl -fsSL https://raw.githubusercontent.com/NoFxAiOS/nofx/main/install.sh | bash`',
              'Docker: download `docker-compose.prod.yml` and run `docker compose -f docker-compose.prod.yml up -d`',
              'Windows: install Docker Desktop, then use the Docker route above.',
              'From source: Go 1.21+, Node 18+, TA-Lib (`brew install ta-lib` / `apt-get install libta-lib0-dev`), then `go run .` and `npm --prefix web run dev`.',
            ],
          },
          {
            type: 'p',
            text: 'Then open `http://127.0.0.1:3000` — the web UI is on port 3000, the API on 8080.',
          },
        ],
      },
      {
        id: 'how-to-update',
        question: 'How do I update?',
        blocks: [
          {
            type: 'p',
            text: 'Re-run the install script, or with Docker: `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`. Your database and keys live in the mounted `data/` directory and survive updates. Running traders are restarted automatically after the backend comes back.',
          },
        ],
      },
      {
        id: 'launch-blocked',
        question: 'Launch is blocked by a failing check — now what?',
        blocks: [
          {
            type: 'p',
            text: 'Read the message: every preflight failure names its fix and routes you to the right setup step — fund the AI wallet, finish the Hyperliquid authorization, or deposit trading USDC. Balances are re-checked live, so once you fix the item the launch goes through.',
          },
        ],
      },
      {
        id: 'exchange-unreachable',
        question: 'The exchange account shows "invalid credentials" or "unavailable".',
        blocks: [
          {
            type: 'list',
            items: [
              'Invalid credentials: the agent authorization expired (180 days) or the saved key is stale — reconnect the Hyperliquid wallet; the flow offers a one-click renewal.',
              'Unavailable: the exchange API did not respond; the account state is cached for 30 seconds, so wait and refresh.',
              'CEX keys: verify trading permission, IP whitelist, and that futures/perp access is enabled.',
            ],
          },
        ],
      },
      {
        id: 'where-are-logs',
        question: 'Where are the logs?',
        blocks: [
          {
            type: 'list',
            items: [
              'Backend: `docker logs nofx-trading` (or the terminal running `go run .`).',
              'Per-cycle AI reasoning and errors: the dashboard Execution Log.',
              'Frontend build/runtime issues: browser devtools console.',
            ],
          },
        ],
      },
      {
        id: 'port-conflicts',
        question: 'Port 3000 or 8080 is already in use.',
        blocks: [
          {
            type: 'p',
            text: 'Stop the conflicting service or remap the published ports in your compose file (e.g. `"3100:80"` for the frontend, `"8180:8080"` for the API), then restart the containers.',
          },
        ],
      },
    ],
  },

  // ───────────────────────── Contributing ─────────────────────────
  {
    id: 'contributing',
    title: 'Contributing',
    icon: GitBranch,
    items: [
      {
        id: 'how-to-contribute',
        question: 'How do I contribute code?',
        blocks: [
          {
            type: 'links',
            links: [
              {
                label: 'Roadmap',
                href: 'https://github.com/orgs/NoFxAiOS/projects/3',
              },
              {
                label: 'Task Dashboard',
                href: 'https://github.com/orgs/NoFxAiOS/projects/5',
              },
              {
                label: 'CONTRIBUTING.md',
                href: 'https://github.com/NoFxAiOS/nofx/blob/dev/CONTRIBUTING.md',
              },
            ],
          },
          {
            type: 'steps',
            items: [
              'Pick a task from the boards above (filter by good first issue / help wanted) and comment "assign me".',
              'Fork the repo and branch from `dev`: `git checkout -b feat/your-topic`.',
              'Follow Conventional Commits; run `npm --prefix web run lint && npm --prefix web run build` before pushing.',
              'Open a PR against `NoFxAiOS/nofx:dev`, reference the issue (`Closes #123`), and attach screenshots for UI changes.',
            ],
          },
        ],
      },
      {
        id: 'bounty-program',
        question: 'Is there a bounty program?',
        blocks: [
          {
            type: 'p',
            text: 'Yes — selected issues carry cash bounties, plus badges, priority review, and beta access for regular contributors.',
          },
          {
            type: 'links',
            links: [
              {
                label: 'Issues with bounty label',
                href: 'https://github.com/NoFxAiOS/nofx/labels/bounty',
              },
              {
                label: 'Bounty claim template',
                href: 'https://github.com/NoFxAiOS/nofx/blob/dev/.github/ISSUE_TEMPLATE/bounty_claim.md',
              },
            ],
          },
        ],
      },
      {
        id: 'report-bugs',
        question: 'How do I report a bug?',
        blocks: [
          {
            type: 'p',
            text: 'Open a GitHub issue with the template: what you did, what happened, backend logs (`docker logs nofx-trading`), and screenshots. For suspected security issues, please follow the responsible-disclosure notes in SECURITY.md instead of a public issue.',
          },
          {
            type: 'links',
            links: [
              {
                label: 'New issue',
                href: 'https://github.com/NoFxAiOS/nofx/issues/new/choose',
              },
              {
                label: 'SECURITY.md',
                href: 'https://github.com/NoFxAiOS/nofx/blob/dev/SECURITY.md',
              },
            ],
          },
        ],
      },
    ],
  },
]

/**
 * Chinese (简体中文) FAQ content. Mirrors `faqCategories` exactly — same ids,
 * icons, order and block structure — so FAQLayout can swap the dataset by
 * language without touching the renderers.
 */
export const faqCategoriesZh: FAQCategory[] = [
  // ───────────────────────── 入门指南 ─────────────────────────
  {
    id: 'getting-started',
    title: '入门指南',
    icon: BookOpen,
    items: [
      {
        id: 'what-is-nofx',
        question: 'NOFX 是什么？',
        blocks: [
          {
            type: 'p',
            text: 'NOFX 是一个开源、可自托管的 AI 交易终端。它的旗舰模式是 NOFX Autopilot：一个 AI 智能体，会读取 Claw402.ai 的信号榜单，用 Signal Lab 和清算结构验证候选标的，再用原始 K 线确认入场时机，最后在 Hyperliquid 上执行交易——全程运行在你自己的机器上，密钥永远不会离开你的服务器。',
          },
          {
            type: 'p',
            text: '除了 Autopilot，你还可以在 Strategy Studio 里构建自定义策略，让多个 AI 交易员并行运行，并在排行榜上对比它们的表现。',
          },
        ],
      },
      {
        id: 'what-do-i-need',
        question: '启动 Autopilot 之前需要准备什么？',
        blocks: [
          {
            type: 'p',
            text: '两个已充值的账户——Config 页面的引导式启动流程会带你完成两者的设置：',
          },
          {
            type: 'list',
            items: [
              'AI 手续费钱包：一个 Base 链上的 USDC 钱包，用于支付 AI 模型和行情数据的调用费用。启动至少需要 `1 USDC`。',
              '一个已开通交易授权的 Hyperliquid 账户，且至少有 `12 USDC` 可用作保证金。',
            ],
          },
          {
            type: 'p',
            text: '点击启动按钮后，服务器会先运行一次预检，逐项核查所有前置条件，并明确指出缺的是哪一步，所以你不可能启动一个只配置了一半的机器人。',
          },
        ],
      },
      {
        id: 'which-markets',
        question: '它可以交易哪些市场？',
        blocks: [
          {
            type: 'p',
            text: 'Autopilot 交易的是 Hyperliquid 永续合约：主流加密货币（BTC、ETH、SOL 等），外加 xyz 合成市场，覆盖美股、指数、大宗商品和外汇——一个账户就能让 AI 面对多资产标的池。',
          },
          {
            type: 'p',
            text: '在 Strategy Studio 里手动构建的交易员还可以连接 Binance、Bybit、OKX、Bitget、KuCoin、Gate、Aster 和 Lighter。',
          },
        ],
      },
      {
        id: 'ai-models',
        question: '它用哪些 AI 模型？我需要准备 API 密钥吗？',
        blocks: [
          {
            type: 'p',
            text: '不需要任何 API 密钥。NOFX 通过 Claw402 的按量付费基础设施进行推理：由你的 AI 手续费钱包用 Base USDC 按次付费，终端按需调用受支持的模型（DeepSeek 及其他前沿模型）。',
          },
          {
            type: 'p',
            text: '进阶用户也可以在 Config → Models 中接入自己的服务商密钥（OpenAI、Claude、Gemini、DeepSeek、Qwen、Grok、Kimi，或任何兼容 OpenAI 接口的端点）。',
          },
        ],
      },
      {
        id: 'is-it-profitable',
        question: '它能赚钱吗？',
        blocks: [
          {
            type: 'p',
            text: '没有人能保证这一点，凡是向你保证的人都不值得信任。AI 执行的是一套系统化的流程，但市场充满对抗，过往表现永远不代表未来结果。',
          },
          {
            type: 'p',
            text: '仪表盘在业绩展示上刻意做到诚实：它把已实现和未实现盈亏分开列示，展示手续费拖累链条（毛利润 − 手续费 = 净利润）、利润因子，以及按你的真实起始余额计算的最大回撤。盯紧这些数字，从小额开始，只用亏得起的钱交易。',
          },
          {
            type: 'note',
            text: '交易存在重大亏损风险。NOFX 是软件，不构成投资建议。',
          },
        ],
      },
    ],
  },

  // ───────────────────────── 启动与钱包 ─────────────────────────
  {
    id: 'launch-wallets',
    title: '启动与钱包',
    icon: Zap,
    items: [
      {
        id: 'ai-fee-wallet',
        question: '什么是 AI 手续费钱包？',
        blocks: [
          {
            type: 'p',
            text: '一个位于 Base 链上的专用 EVM 钱包，专门用来支付 AI 模型调用和付费行情数据的费用（x402 微支付）。它与你的交易保证金完全分开——永远不会接触 Hyperliquid。',
          },
          {
            type: 'list',
            items: [
              '引导式设置流程会为你创建它（也可以复用已有的钱包）。',
              '只能通过 Base 网络向它的地址存入 USDC。',
              '启动要求至少 `1 USDC`；充值后余额显示会自动刷新。',
              '一个周期的典型成本从不到一美分到几美分不等，取决于所用模型。',
            ],
          },
        ],
      },
      {
        id: 'fee-wallet-private-key',
        question: 'AI 手续费钱包的私钥存在哪里？',
        blocks: [
          {
            type: 'p',
            text: '私钥在你的服务器本地生成，加密（AES-256）后存入你自己的数据库，并且只在引导设置界面向你展示一次。请务必备份——一旦丢失数据库，私钥无法找回。',
          },
          {
            type: 'note',
            text: '这个钱包里只放支付手续费的钱。它的用途是支付 AI 调用，不是存钱的地方。',
          },
        ],
      },
      {
        id: 'hyperliquid-authorization',
        question: 'Hyperliquid 授权是怎么运作的？安全吗？',
        blocks: [
          {
            type: 'p',
            text: 'NOFX 使用 Hyperliquid 代理钱包（agent wallet），因此你的主钱包私钥永远不需要交出来。连接流程包含四个签名步骤：',
          },
          {
            type: 'steps',
            items: [
              '连接你的 EVM 钱包（Rabby、MetaMask、OKX、Coinbase Wallet）。',
              '批准一个新生成的 NOFX 代理钱包——有效期 180 天，仅可用于交易。',
              '批准 builder 费（每笔订单收取的小额费用，用于支持平台运营）。',
              '把代理密钥保存到你的 NOFX 服务器（加密存储）。',
            ],
          },
          {
            type: 'p',
            text: '代理钱包只能下单和平仓，别无他能。它无法提取资金，你的保证金始终留在你自己的 Hyperliquid 账户里。',
          },
        ],
      },
      {
        id: 'launch-preflight',
        question: '启动预检会检查哪些内容？',
        blocks: [
          {
            type: 'p',
            text: '在创建或修改任何东西之前，服务器会用实时数据验证整条链路：',
          },
          {
            type: 'list',
            items: [
              'AI 模型已启用且配有凭据。',
              'AI 手续费钱包密钥有效，且 Base USDC 余额至少 `1 USDC`（链上查询）。',
              'Hyperliquid 账户已完成授权（代理钱包 + builder 费）且可正常连接。',
              '交易资金：至少 `12 USDC`，未平仓仓位中的权益也计入。',
            ],
          },
          {
            type: 'p',
            text: '每一项未通过的检查都会写明具体的修复方法，并深链到引导设置的对应步骤。同样的检查在每次启动时都会在服务器端强制执行，UI 无法被意外绕过。',
          },
        ],
      },
      {
        id: 'relaunch-behavior',
        question: '再次点击 Launch 会发生什么？',
        blocks: [
          {
            type: 'p',
            text: '启动是幂等的。如果已存在一个 NOFX Autopilot，启动器会用当前的策略配置更新它并重启它——绝不会创建重复的交易员。如果机器人正处于周期中途，重启最多可能需要一分钟；UI 会等待它完成。',
          },
        ],
      },
      {
        id: 'deposit-not-showing',
        question: '我已经存入 USDC，但余额还是显示为零。',
        blocks: [
          {
            type: 'list',
            items: [
              'AI 手续费钱包：确认你是通过 Base 网络把 USDC 发送到了页面显示的确切地址。余额缓存约 30 秒，设置面板每隔几秒会自动重新检查。',
              'Hyperliquid：充值会进入你自己的 Hyperliquid 账户；余额步骤轮询的是实时账户状态。如有疑问，在引导面板里点击 Refresh。',
              '如果链上 RPC 暂时不可达，面板会把余额标为未知而不是零——等一分钟再重试。',
            ],
          },
        ],
      },
    ],
  },

  // ───────────────────────── 交易与执行 ─────────────────────────
  {
    id: 'trading',
    title: '交易与执行',
    icon: TrendingUp,
    items: [
      {
        id: 'autopilot-pipeline',
        question: 'Autopilot 策略具体是怎么一步步运作的？',
        blocks: [
          {
            type: 'p',
            text: '每个周期都运行同样的四阶段漏斗——每个阶段都可以淘汰候选标的，只有全部通过的形态才会真正交易：',
          },
          {
            type: 'steps',
            items: [
              '构建标的池——拉取 Claw402.ai 的实时排名，取排名靠前的候选标的（默认 10 个），覆盖主流加密货币和 xyz 合成市场（美股、指数、大宗商品、外汇），每个标的都带有方向倾向和信号 z 分数。',
              '逐个验证候选标的——获取其 Signal Lab 深度信号，以及价格周围的成本/清算结构：清算集群和成本基础能显示一波行情前方是有燃料还是有阻力墙。',
              '确认时机——读取原始的 15 分钟 OHLCV K 线（30 根），确认入场点顺应结构，而不是在追赶一段已经走过头的行情。',
              '决策与仓位——只有置信度超过阈值（默认 `78/100`）、且盈亏比约为 `3:1` 的形态才会以 10 倍杠杆开仓；平仓永远先于开仓执行，多头和空头两个方向每个周期都会被考虑。',
            ],
          },
          {
            type: 'p',
            text: '还有第五层完全独立于 AI 之外：硬性风控（仓位上限、杠杆上限、保证金上限、交易节流）会拒绝任何违反它们的决策，无论模型多有信心。',
          },
        ],
      },
      {
        id: 'data-sources',
        question: '它使用哪些数据？哪些部分是付费的？',
        blocks: [
          {
            type: 'list',
            items: [
              'Claw402.ai 信号数据——排名榜、每个标的的 Signal Lab 深度信号、市场净流量。这些是付费端点，按调用次数从你的 AI 手续费钱包以 USDC 收费（x402 微支付）。',
              '成本/清算热力图——每个市场聚合的持仓成本与清算集群结构。',
              'Hyperliquid 行情数据——原始 OHLCV K 线和实时 L2 订单簿（免费公开数据）。',
              '通过代理钱包读取的你的账户信息——权益、可用保证金、带盈亏的未平仓仓位。',
              '它自己的历史记录——已平仓交易会把胜率、利润因子和回撤反馈到下一轮提示词里，让 AI 了解自己近期的状态。',
            ],
          },
          {
            type: 'note',
            text: '仪表盘对付费的 Claw402 端点轮询较慢（每隔几分钟），以节省你的手续费钱包——行情数据面板则通过免费数据源保持实时更新。',
          },
        ],
      },
      {
        id: 'decision-cycle',
        question: 'AI 多久做一次决策？',
        blocks: [
          {
            type: 'p',
            text: 'Autopilot 每 5–15 分钟运行一个扫描周期，具体取决于你启动时的设置（每个交易员可单独配置，最短 3 分钟）。第一个周期在启动后立即开始；单个周期通常需要 30–60 秒，因为 AI 在做决策前会通读完整的市场背景。',
          },
        ],
      },
      {
        id: 'what-ai-sees',
        question: 'AI 在每个周期能看到哪些信息？',
        blocks: [
          {
            type: 'list',
            items: [
              '你的账户：权益、可用保证金、带盈亏的未平仓仓位。',
              'Claw402 排名榜：带方向倾向的候选标的池。',
              '每个候选标的的 Signal Lab 深度信号和成本/清算结构。',
              '用于确认时机的原始 OHLCV K 线。',
              '它自己的战绩：胜率、利润因子、回撤、近期交易。',
            ],
          },
          {
            type: 'p',
            text: '每个周期都会存为一条决策记录——仪表盘上的 Execution Log 会展示推理链、执行动作以及任何被拦截的订单。',
          },
        ],
      },
      {
        id: 'leverage-and-risk',
        question: '它使用什么杠杆和风控措施？',
        blocks: [
          {
            type: 'p',
            text: 'Autopilot 默认使用 10 倍全仓保证金（cross margin）。硬性风控在 AI 之外运行，AI 无法覆盖它们：',
          },
          {
            type: 'list',
            items: [
              '策略配置中的持仓数量上限——达到上限后，新的开仓会被拒绝。',
              '按资产类别区分的杠杆限制（BTC/ETH 与山寨币不同）。',
              '交易节流会阻止无效折腾，例如开仓几分钟后就平掉一个几乎没动的仓位。',
              '安全模式（见下文）在 AI 本身出故障时保护仓位。',
            ],
          },
        ],
      },
      {
        id: 'safe-mode',
        question: '什么是安全模式？',
        blocks: [
          {
            type: 'p',
            text: '如果 AI 连续 3 个周期失败（服务商宕机、手续费钱包余额不足、返回异常），交易员会进入安全模式：不再开新仓，已有仓位继续受保护，循环会持续重试。下一次 AI 调用成功后，它会自动退出安全模式。',
          },
          {
            type: 'p',
            text: '安全模式会以横幅形式显示在仪表盘上并注明原因，绝不会悄无声息地发生。',
          },
        ],
      },
      {
        id: 'fee-wallet-empty-mid-run',
        question: '如果 AI 手续费钱包在运行中途没钱了会怎样？',
        blocks: [
          {
            type: 'p',
            text: 'AI 调用会开始失败，并明确显示「余额不足」的状态。仪表盘会持续显示一条红色横幅，注明钱包余额；连续三个周期失败后，机器人会进入安全模式。向手续费钱包补入 Base USDC 后，交易员会自行恢复——无需重启。',
          },
        ],
      },
      {
        id: 'trading-fees',
        question: '我要付哪些费用？',
        blocks: [
          {
            type: 'list',
            items: [
              '每笔订单的 Hyperliquid 交易手续费，外加已批准的 builder 费。',
              '从手续费钱包按次支付的 AI/数据成本（每个周期几美分）。',
            ],
          },
          {
            type: 'p',
            text: '手续费是高频策略的隐形杀手。仪表盘的统计栏会展示完整链条——已实现毛利润，减去手续费，等于净利润——让你立刻看出手续费是否在侵蚀策略优势。',
          },
        ],
      },
      {
        id: 'stop-and-manual',
        question: '如何停止机器人或手动平仓？',
        blocks: [
          {
            type: 'list',
            items: [
              '停止：在 Config 页面的交易员列表中点击 Stop 按钮。停止后决策循环会中止；未平仓仓位保持打开，由你自行管理。',
              '手动平仓：在仪表盘的仓位面板里平掉任意仓位——手动平仓会同步回仓位历史记录。',
              '紧急情况：你随时可以直接在 Hyperliquid 上管理仓位；NOFX 永远不会把你挡在自己的账户之外。',
            ],
          },
        ],
      },
    ],
  },

  // ───────────────────────── 仪表盘与指标 ─────────────────────────
  {
    id: 'dashboard',
    title: '仪表盘与指标',
    icon: Monitor,
    items: [
      {
        id: 'metrics-meaning',
        question: '顶部的指标到底是什么意思？',
        blocks: [
          {
            type: 'list',
            items: [
              'Equity（权益）——包含未实现盈亏的实时账户价值。',
              'Total P/L（总盈亏，含未实现）——权益相对于你的起始余额的变化；会随未平仓仓位浮动。',
              'Realized P/L（已实现盈亏，已平仓交易）——只计算已结束交易的净结果；胜率、利润因子和夏普比率都是基于它计算的。',
              'Profit factor（利润因子）——已平仓交易的总盈利 ÷ 总亏损；高于 1.0 表示已平仓部分净盈利。',
              'Max drawdown（最大回撤）——已实现权益曲线从峰值到谷值的最大跌幅，按你的真实起始余额衡量。',
            ],
          },
        ],
      },
      {
        id: 'pl-contradiction',
        question: '为什么 Total P/L 是正的，而 Realized P/L 却是负的？',
        blocks: [
          {
            type: 'p',
            text: '因为它们衡量的东西不同。Realized P/L 只计算已平仓交易；Total P/L 还包括仍未平仓仓位的未实现盈利。一个机器人在已平仓交易上是亏的，但只要未平仓部分有足够的浮动盈利，总盈亏就能是正的——反之亦然。查看毛利润/手续费/净利润那一栏，就能看出已实现结果中有多少是手续费拖累造成的。',
          },
        ],
      },
      {
        id: 'execution-log',
        question: '在哪里能看到 AI 做（或拒绝做）某件事的原因？',
        blocks: [
          {
            type: 'p',
            text: 'Execution Log（执行日志）面板列出每个周期采取的动作、AI 调用耗时，以及任何被拦截的订单和触发拦截的确切规则（节流、仓位上限、风控）。完整的推理链会随每条决策记录一起保存。',
          },
        ],
      },
      {
        id: 'competition',
        question: '排行榜/竞赛是什么？',
        blocks: [
          {
            type: 'p',
            text: '启用了「在竞赛中展示」的交易员会出现在公开排行榜上，按实时表现排名。每个交易员都可以单独选择是否参加，并随时在交易员列表中切换。',
          },
        ],
      },
    ],
  },

  // ───────────────────────── 安全 ─────────────────────────
  {
    id: 'security',
    title: '安全',
    icon: Shield,
    items: [
      {
        id: 'key-storage',
        question: '我的密钥是如何存储的？',
        blocks: [
          {
            type: 'list',
            items: [
              '所有机密信息（代理密钥、手续费钱包密钥、交易所 API 密钥）在静态存储时都经过 AES-256 加密，保存在你自己的数据库中。',
              '可选的 RSA 传输加密，保护浏览器与服务器之间传输中的机密信息。',
              'NOFX 是自托管的：任何数据都不会发送到第三方服务器。代码开源，可供审计。',
            ],
          },
        ],
      },
      {
        id: 'can-nofx-steal-funds',
        question: 'NOFX 能提取或盗走我的资金吗？',
        blocks: [
          {
            type: 'p',
            text: '不能。在 Hyperliquid 上，NOFX 持有的只是代理钱包，按协议设计它只能交易、不能提现。你的保证金留在你自己的账户里，由你的主钱包掌控。',
          },
          {
            type: 'note',
            text: '如果你改接中心化交易所（CEX），创建它的 API 密钥时只给交易权限——禁用提现，并设置 IP 白名单。',
          },
        ],
      },
      {
        id: 'registration-model',
        question: '为什么别人无法在我的实例上注册？',
        blocks: [
          {
            type: 'p',
            text: '这是刻意的设计：一个实例是单操作员的——第一个注册的账户成为操作员，之后注册通道关闭（界面提示「System already initialized」）。这样可以防止陌生人在暴露于公网的部署上创建账户。每个操作员运行一个自己的实例。',
          },
        ],
      },
    ],
  },

  // ───────────────────────── 自托管与故障排查 ─────────────────────────
  {
    id: 'self-hosting',
    title: '自托管与故障排查',
    icon: Wrench,
    items: [
      {
        id: 'how-to-install',
        question: '如何安装 NOFX？',
        blocks: [
          {
            type: 'p',
            text: '在 Linux/macOS 上一行命令即可（通过 Docker 安装并启动全部服务）：',
          },
          {
            type: 'list',
            items: [
              '安装脚本：`curl -fsSL https://raw.githubusercontent.com/NoFxAiOS/nofx/main/install.sh | bash`',
              'Docker：下载 `docker-compose.prod.yml`，然后运行 `docker compose -f docker-compose.prod.yml up -d`',
              'Windows：先安装 Docker Desktop，再走上面的 Docker 路线。',
              '从源码安装：Go 1.21+、Node 18+、TA-Lib（`brew install ta-lib` / `apt-get install libta-lib0-dev`），然后运行 `go run .` 和 `npm --prefix web run dev`。',
            ],
          },
          {
            type: 'p',
            text: '之后打开 `http://127.0.0.1:3000`——Web 界面在 3000 端口，API 在 8080 端口。',
          },
        ],
      },
      {
        id: 'how-to-update',
        question: '如何更新？',
        blocks: [
          {
            type: 'p',
            text: '重新运行安装脚本，或者用 Docker：`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`。你的数据库和密钥位于挂载的 `data/` 目录中，更新后不会丢失。后端恢复后，运行中的交易员会自动重启。',
          },
        ],
      },
      {
        id: 'launch-blocked',
        question: '启动被某项未通过的检查拦住了，怎么办？',
        blocks: [
          {
            type: 'p',
            text: '仔细看提示信息：每项预检失败都会写明修复方法，并把你引导到正确的设置步骤——给 AI 钱包充值、完成 Hyperliquid 授权，或存入交易用的 USDC。余额是实时复查的，所以你修好那一项后，启动就能通过。',
          },
        ],
      },
      {
        id: 'exchange-unreachable',
        question: '交易所账户显示「invalid credentials」或「unavailable」。',
        blocks: [
          {
            type: 'list',
            items: [
              '凭据无效：代理授权已过期（180 天），或保存的密钥已失效——重新连接 Hyperliquid 钱包，流程中提供一键续期。',
              '不可用：交易所 API 未响应；账户状态有 30 秒缓存，稍等片刻后刷新。',
              'CEX 密钥：核对交易权限、IP 白名单，并确认已开启合约/永续交易权限。',
            ],
          },
        ],
      },
      {
        id: 'where-are-logs',
        question: '日志在哪里？',
        blocks: [
          {
            type: 'list',
            items: [
              '后端：`docker logs nofx-trading`（或运行 `go run .` 的终端）。',
              '每个周期的 AI 推理和错误：仪表盘的 Execution Log。',
              '前端构建/运行问题：浏览器开发者工具的控制台。',
            ],
          },
        ],
      },
      {
        id: 'port-conflicts',
        question: '3000 或 8080 端口已被占用。',
        blocks: [
          {
            type: 'p',
            text: '停掉冲突的服务，或在你的 compose 文件中重新映射对外端口（例如前端用 `"3100:80"`，API 用 `"8180:8080"`），然后重启容器。',
          },
        ],
      },
    ],
  },

  // ───────────────────────── 参与贡献 ─────────────────────────
  {
    id: 'contributing',
    title: '参与贡献',
    icon: GitBranch,
    items: [
      {
        id: 'how-to-contribute',
        question: '如何贡献代码？',
        blocks: [
          {
            type: 'links',
            links: [
              {
                label: '路线图',
                href: 'https://github.com/orgs/NoFxAiOS/projects/3',
              },
              {
                label: '任务看板',
                href: 'https://github.com/orgs/NoFxAiOS/projects/5',
              },
              {
                label: 'CONTRIBUTING.md',
                href: 'https://github.com/NoFxAiOS/nofx/blob/dev/CONTRIBUTING.md',
              },
            ],
          },
          {
            type: 'steps',
            items: [
              '从上面的看板里挑一个任务（可用 good first issue / help wanted 筛选），并评论「assign me」。',
              'Fork 仓库，并从 `dev` 分支切出新分支：`git checkout -b feat/your-topic`。',
              '遵循 Conventional Commits 规范；推送前运行 `npm --prefix web run lint && npm --prefix web run build`。',
              '向 `NoFxAiOS/nofx:dev` 提交 PR，引用对应 issue（`Closes #123`），UI 改动请附上截图。',
            ],
          },
        ],
      },
      {
        id: 'bounty-program',
        question: '有赏金计划吗？',
        blocks: [
          {
            type: 'p',
            text: '有——部分选定的 issue 带有现金赏金，常客贡献者还可以获得徽章、优先审核和 beta 测试资格。',
          },
          {
            type: 'links',
            links: [
              {
                label: '带 bounty 标签的 issue',
                href: 'https://github.com/NoFxAiOS/nofx/labels/bounty',
              },
              {
                label: '赏金申领模板',
                href: 'https://github.com/NoFxAiOS/nofx/blob/dev/.github/ISSUE_TEMPLATE/bounty_claim.md',
              },
            ],
          },
        ],
      },
      {
        id: 'report-bugs',
        question: '如何报告 bug？',
        blocks: [
          {
            type: 'p',
            text: '按模板新建一个 GitHub issue：你做了什么、发生了什么、后端日志（`docker logs nofx-trading`）和截图。如果是疑似安全问题，请按 SECURITY.md 中的负责任披露说明处理，不要公开提交 issue。',
          },
          {
            type: 'links',
            links: [
              {
                label: '新建 issue',
                href: 'https://github.com/NoFxAiOS/nofx/issues/new/choose',
              },
              {
                label: 'SECURITY.md',
                href: 'https://github.com/NoFxAiOS/nofx/blob/dev/SECURITY.md',
              },
            ],
          },
        ],
      },
    ],
  },
]
