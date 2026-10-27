import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Download,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react'
import { ROUTES } from '../../router/paths'
import { useLanguage } from '../../contexts/LanguageContext'

function getSetupSteps(isZh: boolean) {
  return [
  {
    title: isZh ? '创建你的 NOFX 账户' : 'Create your NOFX account',
    detail:
      isZh ? '你的账户将 Autopilot 配置、钱包授权状态和交易看板集中在一处管理。' : 'Your account keeps the Autopilot configuration, wallet authorization state, and trading dashboard in one place.',
    icon: KeyRound,
    action: isZh ? '创建账户' : 'Create account',
    to: ROUTES.register,
  },
  {
    title: isZh ? '为 AI 手续费钱包充值' : 'Fund the AI fee wallet',
    detail:
      isZh ? 'NOFX 会准备一个 Base USDC 钱包，用于 Claw402.ai 数据和模型调用。该钱包与交易抵押品分开。' : 'NOFX prepares a Base USDC wallet for Claw402.ai data and model calls. This wallet is separate from trading collateral.',
    icon: CircleDollarSign,
    action: isZh ? '打开充值二维码' : 'Open deposit QR',
    to: ROUTES.login,
    returnUrl: `${ROUTES.traders}?setup=claw402`,
  },
  {
    title: isZh ? '授权 Hyperliquid' : 'Authorize Hyperliquid',
    detail:
      isZh ? '连接你的交易钱包，批准 NOFX Agent，并批准 builder 费用。资金保留在你的 Hyperliquid 账户中。' : 'Connect your trading wallet, approve the NOFX Agent, and approve the builder fee. Funds remain in your Hyperliquid account.',
    icon: Wallet,
    action: isZh ? '连接交易所' : 'Connect exchange',
    to: ROUTES.login,
    returnUrl: `${ROUTES.traders}?setup=hyperliquid`,
  },
  {
    title: isZh ? '存入交易 USDC' : 'Deposit trading USDC',
    detail:
      isZh ? '在 Hyperliquid 中充入 USDC，然后启动 NOFX Autopilot。策略会自动创建并启动。' : 'Add USDC on Hyperliquid, then start NOFX Autopilot. The strategy is created and launched automatically.',
    icon: Zap,
    action: isZh ? '打开 Hyperliquid' : 'Open Hyperliquid',
    href: 'https://app.hyperliquid.xyz/',
  },
  ]
}

function getPipeline(isZh: boolean) {
  return [
  isZh ? '读取 Claw402.ai 实时榜单，美股优先于加密货币。' : 'Read the live Claw402.ai board, with US stocks prioritized before crypto.',
  isZh ? '加载每个候选标的的当前方向、方向历史以及成本/强平结构。' : 'Load current direction, direction history, and cost/liquidation structure for each candidate.',
  isZh ? '用原始 OHLCV K 线确认，只有形态足够强时才以 10 倍杠杆全仓交易。' : 'Confirm with raw OHLCV candles, then trade full-size 10x only when the setup is strong enough.',
  ]
}

export function TraderLaunchGuestPage() {
  const { language } = useLanguage()
  const isZh = language === 'zh'
  const setupSteps = getSetupSteps(isZh)
  const pipeline = getPipeline(isZh)

  return (
    <div className="min-h-[calc(100vh-4rem)] overflow-hidden bg-nofx-bg px-4 py-10 md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="grid gap-8 rounded-2xl border border-nofx-gold/20 bg-nofx-bg-lighter p-6 md:p-8 xl:grid-cols-[1.02fr_0.98fr]">
          <div className="flex flex-col justify-center">
            <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-nofx-gold/25 bg-nofx-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-nofx-gold">
              <ShieldCheck className="h-3.5 w-3.5" />
              NOFX Autopilot
            </div>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-nofx-text md:text-5xl">
              {isZh ? '一个策略，四步设置，然后开始交易。' : 'One strategy. Four setup steps. Then it trades.'}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-nofx-text-muted">
              {isZh
                ? 'NOFX 只运行一个由 Claw402 驱动的策略：榜单、各市场详情、强平结构、K 线、执行。无需挑选策略，也无需手动选币。'
                : 'NOFX runs a single Claw402-driven strategy: board, per-market details, liquidation structure, candles, execution. No strategy picker, no manual symbol picking required.'}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                to={ROUTES.login}
                onClick={() =>
                  sessionStorage.setItem(
                    'returnUrl',
                    `${ROUTES.traders}?setup=claw402`
                  )
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-nofx-gold px-5 py-3 text-sm font-bold text-white transition hover:bg-nofx-gold/90"
              >
                {isZh ? '开始设置' : 'Start setup'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to={ROUTES.register}
                className="inline-flex items-center justify-center rounded-xl border border-nofx-gold/20 bg-nofx-bg-deeper px-5 py-3 text-sm font-semibold text-nofx-text transition hover:border-nofx-gold/40 hover:bg-nofx-bg-deeper"
              >
                {isZh ? '创建账户' : 'Create account'}
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {setupSteps.map((step, index) => {
              const Icon = step.icon
              const cardClass =
                'group rounded-xl border border-nofx-gold/20 bg-nofx-bg-deeper p-4 text-left transition hover:border-nofx-gold/35 hover:bg-nofx-gold/6'
              const content = (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-nofx-gold/20 bg-nofx-gold/10 text-nofx-gold">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="font-mono text-xs text-nofx-text-muted">
                      0{index + 1}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold text-nofx-text">
                    {step.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-nofx-text-muted">
                    {step.detail}
                  </p>
                  <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-nofx-gold transition group-hover:text-nofx-gold/80">
                    {step.action}
                    {step.href ? (
                      <ExternalLink className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowRight className="h-3.5 w-3.5" />
                    )}
                  </div>
                </>
              )

              if (step.href) {
                return (
                  <a
                    key={step.title}
                    href={step.href}
                    target="_blank"
                    rel="noreferrer"
                    className={cardClass}
                  >
                    {content}
                  </a>
                )
              }

              return (
                <Link
                  key={step.title}
                  to={step.to || ROUTES.login}
                  onClick={() => {
                    if (step.returnUrl) {
                      sessionStorage.setItem('returnUrl', step.returnUrl)
                    }
                  }}
                  className={cardClass}
                >
                  {content}
                </Link>
              )
            })}
          </div>
        </section>

        <section className="grid gap-5 rounded-2xl border border-nofx-gold/20 bg-nofx-bg-lighter p-5 md:grid-cols-[0.78fr_1.22fr] md:p-6">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-nofx-gold">
              {isZh ? '还没有交易钱包？' : 'No trading wallet yet?'}
            </div>
            <p className="mt-3 text-sm leading-6 text-nofx-text-muted">
              {isZh
                ? 'NOFX 不需要你的主钱包私钥。安装或解锁一个 EVM 钱包，为 Hyperliquid 充入 USDC，登录后授权 NOFX Agent。'
                : 'NOFX does not need your main-wallet private key. Install or unlock an EVM wallet, fund Hyperliquid with USDC, then authorize the NOFX Agent after sign-in.'}
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <a
              href="https://rabby.io/"
              target="_blank"
              rel="noreferrer"
              className="group rounded-xl border border-nofx-gold/20 bg-nofx-bg-deeper p-4 transition hover:border-nofx-gold/30 hover:bg-nofx-gold/6"
            >
              <Download className="mb-3 h-4 w-4 text-nofx-gold" />
              <div className="font-semibold text-nofx-text">{isZh ? '安装 Rabby' : 'Install Rabby'}</div>
              <p className="mt-2 text-sm leading-6 text-nofx-text-muted">
                {isZh ? '连接 Hyperliquid 前，先创建或导入一个 EVM 钱包。' : 'Create or import an EVM wallet before connecting to Hyperliquid.'}
              </p>
            </a>
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noreferrer"
              className="group rounded-xl border border-nofx-gold/20 bg-nofx-bg-deeper p-4 transition hover:border-nofx-gold/30 hover:bg-nofx-gold/6"
            >
              <ExternalLink className="mb-3 h-4 w-4 text-nofx-gold" />
              <div className="font-semibold text-nofx-text">MetaMask</div>
              <p className="mt-2 text-sm leading-6 text-nofx-text-muted">
                {isZh
                  ? '已经在用 MetaMask？解锁它，然后在 NOFX 内继续设置。'
                  : 'Already use MetaMask? Unlock it, then continue setup inside NOFX.'}
              </p>
            </a>
            <a
              href="https://app.hyperliquid.xyz/"
              target="_blank"
              rel="noreferrer"
              className="group rounded-xl border border-nofx-gold/20 bg-nofx-gold/10 p-4 transition hover:bg-nofx-gold/15"
            >
              <ExternalLink className="mb-3 h-4 w-4 text-nofx-gold" />
              <div className="font-semibold text-nofx-text">
                {isZh ? '打开 Hyperliquid' : 'Open Hyperliquid'}
              </div>
              <p className="mt-2 text-sm leading-6 text-nofx-text-muted">
                {isZh
                  ? '在那里存入 USDC。交易资金保留在你的 Hyperliquid 账户中。'
                  : 'Deposit USDC there. Trading funds stay in your Hyperliquid account.'}
              </p>
            </a>
          </div>
        </section>

        <section className="grid gap-4 rounded-2xl border border-nofx-gold/20 bg-nofx-bg-lighter p-5 md:grid-cols-[0.72fr_1.28fr] md:p-6">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-nofx-gold">
              {isZh ? '启动后运行什么' : 'What runs after launch'}
            </div>
            <p className="mt-3 text-sm leading-6 text-nofx-text-muted">
              {isZh
                ? '每个周期都运行同一条生产路径。界面只要求你充值、授权和启动。'
                : 'The same production path runs every cycle. The interface only asks you to fund, authorize, and start.'}
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {pipeline.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-xl border border-nofx-gold/20 bg-nofx-bg-deeper p-4"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-nofx-success" />
                <p className="text-sm leading-6 text-nofx-text">{item}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
