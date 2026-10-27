import {
  apiKeyVenues,
  defaultMarket,
  venueName,
} from '../../lib/frontierAccounts'
import { accountLabel } from '../../lib/frontierAccounts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AIWalletBackup } from '../common/AIWalletBackup'
import type { AIModel, Exchange } from '../../types'
import { api } from '../../lib/api'
import { planningAPI } from '../../lib/planning'
import type { AccountCheck } from '../../lib/frontierWorkspace'
import { HyperliquidWalletConnect } from '../common/HyperliquidWalletConnect'
import { ExchangeConfigModal } from '../trader/ExchangeConfigModal'
import { ModelConfigModal } from '../trader/ModelConfigModal'
import { useLanguage } from '../../contexts/LanguageContext'

function useSafeLanguage() {
  try {
    return useLanguage().language
  } catch {
    return 'en' as const
  }
}

export type FeeWalletState =
  | 'checking'
  | 'missing'
  | 'empty'
  | 'unknown'
  | 'ready'
type Wallet = {
  found: boolean
  enabled: boolean
  address?: string
  model_id?: string
  chain: string
  asset: string
  balance_usdc?: string
  balance_status: string
}
const formatBalance = (value: string | undefined) =>
  Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
export function feeWalletState(wallet: Wallet): FeeWalletState {
  if (!wallet.found || !wallet.enabled) return 'missing'
  if (
    wallet.balance_status !== 'ok' ||
    !wallet.balance_usdc?.trim() ||
    !Number.isFinite(Number(wallet.balance_usdc)) ||
    Number(wallet.balance_usdc) < 0
  )
    return 'unknown'
  return Number(wallet.balance_usdc) > 0 ? 'ready' : 'empty'
}
export function FrontierSetup({
  models,
  modelID,
  accounts,
  accountID,
  venue,
  loaded,
  open,
  onOpen,
  onRefresh,
  onWalletState,
  onComplete,
}: {
  models: AIModel[]
  modelID: string
  accounts: Exchange[]
  accountID: string
  venue: string
  loaded: boolean
  open: 'ai' | 'exchange' | null
  onOpen: (step: 'ai' | 'exchange' | null) => void
  onRefresh: (
    modelID?: string,
    venue?: string,
    accountID?: string
  ) => Promise<void>
  onWalletState: (state: FeeWalletState) => void
  onComplete?: (step: 'ai' | 'exchange') => void
}) {
  const language = useSafeLanguage()
  const zh = language === 'zh'
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [cex, setCex] = useState(false)
  const [addingAccount, setAddingAccount] = useState(false)
  const [choice, setChoice] = useState(venue)
  const [ownAI, setOwnAI] = useState<AIModel[] | null>(null)
  const [directProviders, setDirectProviders] = useState<AIModel[]>([])
  const [check, setCheck] = useState<AccountCheck | null>(null)
  const dialog = useRef<HTMLElement>(null)
  const mounted = useRef(true),
    request = useRef(0),
    pending = useRef(false),
    accountRequest = useRef(0)
  const selectedModel = models.find((m) => m.id === modelID)
  const status = wallet ? feeWalletState(wallet) : 'checking'
  const aiReady =
    !!selectedModel &&
    (selectedModel.provider !== 'claw402' || status === 'ready')
  const checked = check?.accountID === accountID ? check : null
  const exchangeReady = checked?.status === 'verified'
  const currentAccount = accounts.find((a) => a.id === accountID)
  const refreshWallet = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    const revision = ++request.current
    try {
      const next = await planningAPI<Wallet>(
        'setup-wallet' +
          (selectedModel?.provider === 'claw402'
            ? '?model_id=' + encodeURIComponent(modelID)
            : '')
      )
      if (mounted.current && revision === request.current) {
        setWallet(next)
        onWalletState(feeWalletState(next))
        setError('')
      }
    } catch {
      if (mounted.current && revision === request.current) {
        onWalletState('unknown')
        setWallet(null)
        setError(
          zh
            ? '无法检查你的 AI 余额。创建另一个钱包前，请先重试余额检查。'
            : 'Could not check your AI balance. Retry the balance check before creating another wallet.'
        )
      }
    } finally {
      if (revision === request.current) pending.current = false
    }
  }, [onWalletState, selectedModel?.provider, modelID, zh])
  const verifyAccount = useCallback(
    async (background = false) => {
      const revision = ++accountRequest.current
      if (!accountID) {
        setCheck(null)
        return
      }
      setCheck((previous) =>
        background &&
        previous?.accountID === accountID &&
        previous.status === 'verified'
          ? previous
          : { accountID, status: 'checking' }
      )
      try {
        const next = await planningAPI<{
          equity: string
          available: string
          position: string
          open_orders: number
        }>(
          `account?exchange_id=${encodeURIComponent(accountID)}&symbol=${defaultMarket(venue)}`
        )
        if (
          !Number.isFinite(Number(next.equity)) ||
          !Number.isFinite(Number(next.available)) ||
          next.equity == null ||
          next.available == null ||
          String(next.equity).trim() === '' ||
          String(next.available).trim() === ''
        )
          throw new Error(
            zh
              ? '交易所没有返回完整余额。请重试核实。'
              : 'The exchange did not return a complete balance. Retry verification.'
          )
        if (mounted.current && revision === accountRequest.current)
          setCheck({
            ...next,
            accountID,
            status: 'verified',
            checkedAt: Date.now(),
          })
      } catch (e) {
        if (mounted.current && revision === accountRequest.current)
          setCheck({
            accountID,
            status: 'unavailable',
            error:
              e instanceof Error
                ? e.message
                : zh
                  ? '无法核实该账户。'
                  : 'Could not verify the account.',
          })
      }
    },
    [accountID, venue, zh]
  )
  useEffect(() => {
    mounted.current = true
    setWallet(null)
    setCopied(false)
    onWalletState('checking')
    void refreshWallet()
    return () => {
      mounted.current = false
      request.current++
      pending.current = false
    }
  }, [refreshWallet, onWalletState])
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async (background = false) => {
      if (!document.hidden) await verifyAccount(background)
      if (!cancelled && accountID)
        timer = setTimeout(() => void poll(true), 30000)
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
      accountRequest.current++
    }
  }, [verifyAccount, accountID])
  useEffect(() => {
    if (open !== 'ai') return
    let cancelled = false
    void (async () => {
      try {
        const supported = await api.getSupportedModels()
        if (!cancelled)
          setDirectProviders(
            supported.filter(
              (model) =>
                model.provider !== 'claw402' &&
                model.id !== 'claw402' &&
                !model.provider?.startsWith('blockrun')
            )
          )
      } catch {
        if (!cancelled) setDirectProviders([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])
  useEffect(() => {
    if (!open || !wallet?.found || status === 'ready') return
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshWallet()
    }, 15000)
    return () => clearInterval(timer)
  }, [open, wallet?.found, status, refreshWallet])
  useEffect(() => {
    if (open === 'exchange') {
      setChoice(venue)
      void verifyAccount()
    }
  }, [open, venue, verifyAccount])
  useEffect(() => {
    if (!open || cex || ownAI) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpen(null)
      if (event.key !== 'Tab') return
      const items = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)'
        ) || []
      )
      const first = items[0],
        last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keys)
    return () => {
      document.removeEventListener('keydown', keys)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open, cex, ownAI, onOpen])
  async function createWallet() {
    if (working || pending.current) return
    if (!wallet?.found) {
      setOwnAI([
        { id: 'claw402', name: 'Claw402', provider: 'claw402', enabled: false },
      ])
      return
    }
    setWorking(true)
    setError('')
    try {
      const next = await planningAPI<Wallet>('setup-wallet', {
        model_id:
          wallet?.model_id ||
          (selectedModel?.provider === 'claw402' ? modelID : ''),
      })
      if (!mounted.current) return
      setWallet(next)
      onWalletState(feeWalletState(next))
      await onRefresh(selectedModel?.id || next.model_id)
      await refreshWallet()
    } catch {
      if (mounted.current)
        setError(
          zh
            ? '无法确认 AI 设置。重试前请先查看钱包状态。'
            : 'AI setup could not be confirmed. Check the wallet status before retrying.'
        )
    } finally {
      if (mounted.current) setWorking(false)
    }
  }
  async function savedExchange(id?: string) {
    const latest = await api.getExchangeConfigs()
    const saved =
      id ||
      latest.find(
        (a) =>
          a.exchange_type === choice && !accounts.some((old) => old.id === a.id)
      )?.id
    await onRefresh(undefined, choice, saved)
    setCex(false)
    // Stay here for the live check. Saving credentials alone is not verification.
  }
  function finish(step: 'ai' | 'exchange') {
    onComplete?.(step)
    onOpen(null)
  }
  return (
    <>
      {loaded && (
        <section
          className="frontier-connections"
          aria-label={zh ? '你的连接' : 'Your connections'}
        >
          <button onClick={() => onOpen('ai')}>
            <span>{zh ? 'AI 与数据' : 'AI & data'}</span>
            <b>
              {selectedModel?.provider !== 'claw402' && selectedModel
                ? zh
                  ? '你的 API 提供商'
                  : 'Your API provider'
                : status === 'ready'
                  ? `${Number(wallet?.balance_usdc).toFixed(2)} USDC`
                  : status === 'empty'
                    ? zh
                      ? '添加 AI 资金'
                      : 'Add AI funds'
                    : status === 'checking'
                      ? zh
                        ? '正在检查余额…'
                        : 'Checking balance…'
                      : zh
                        ? '设置 AI'
                        : 'Set up AI'}
            </b>
          </button>
          <button
            className="frontier-account-funds"
            onClick={() => onOpen('exchange')}
          >
            <span>{zh ? '交易账户' : 'Trading account'}</span>
            <b>
              {!accountID
                ? zh
                  ? '连接后交易'
                  : 'Connect to trade'
                : exchangeReady
                  ? currentAccount
                    ? accountLabel(currentAccount, accounts)
                    : zh
                      ? '账户'
                      : 'Account'
                  : checked?.status === 'checking'
                    ? zh
                      ? '正在加载余额…'
                      : 'Loading balance…'
                    : zh
                      ? '余额不可用 · 检查连接'
                      : 'Balance unavailable · Check connection'}
            </b>
            {exchangeReady && (
              <>
                <span
                  className="frontier-funds-metric"
                  title={
                    zh
                      ? '账户总权益，包括未实现盈亏。'
                      : 'Total account equity, including unrealized profit and loss.'
                  }
                >
                  {zh ? '账户权益' : 'Account equity'}{' '}
                  <b>
                    {formatBalance(checked.equity)}{' '}
                    {venue === 'hyperliquid' ? 'USDC' : 'USDT'}
                  </b>
                </span>
                <span
                  className="frontier-funds-metric"
                  title={
                    zh
                      ? '可用于新订单的可用保证金，未计杠杆和执行成本。'
                      : 'Free margin available for new orders, before leverage and execution costs.'
                  }
                >
                  {zh ? '可用于交易' : 'Available to trade'}{' '}
                  <b>
                    {formatBalance(checked.available)}{' '}
                    {venue === 'hyperliquid' ? 'USDC' : 'USDT'}
                  </b>
                </span>
              </>
            )}
          </button>
          <small>
            {zh
              ? 'AI 费用和交易资金是分开的。'
              : 'AI fees and trading funds are separate.'}
          </small>
        </section>
      )}
      {open && !cex && !ownAI && (
        <div className="frontier-setup-backdrop">
          <section
            ref={dialog}
            className="frontier-setup-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="frontier-setup-title"
          >
            <header>
              <div>
                <small>
                  {open === 'ai'
                    ? zh
                      ? '分析与数据'
                      : 'ANALYSIS & DATA'
                    : zh
                      ? '你的交易资金'
                      : 'YOUR TRADING FUNDS'}
                </small>
                <h2 id="frontier-setup-title">
                  {open === 'ai'
                    ? zh
                      ? '设置你的 AI'
                      : 'Set up your AI'
                    : currentAccount
                      ? zh
                        ? '你的交易账户'
                        : 'Your trading account'
                      : zh
                        ? '连接交易账户'
                        : 'Connect a trading account'}
                </h2>
              </div>
              <button
                aria-label={zh ? '关闭设置' : 'Close setup'}
                onClick={() => onOpen(null)}
              >
                ×
              </button>
            </header>
            {error && (
              <p role="alert" className="frontier-setup-error">
                {error}
              </p>
            )}
            {open === 'ai' ? (
              <>
                <p>
                  {zh
                    ? '先生成计划。只有当你想下单时，才需要交易账户。'
                    : 'Generate plans first. You only need a trading account when you want to place an order.'}
                </p>
                {selectedModel && selectedModel.provider !== 'claw402' && (
                  <div className="frontier-setup-success">
                    <b>{zh ? '你的 AI 已配置' : 'Your AI is configured'}</b>
                    <p>
                      {zh
                        ? `${selectedModel.name} 通过你的提供商计费。下方的独立 AI 余额仅用于 AI500 等付费数据。`
                        : `${selectedModel.name} bills through your provider. The separate AI balance below is only needed for paid data such as AI500.`}
                    </p>
                  </div>
                )}
                <div className="frontier-ai-options">
                  <b>{zh ? '按量付费' : 'Pay as you go'}</b>
                  <p>
                    {zh
                      ? 'AI 请求和高级数据费用从一个专用的 USDC 钱包扣除。你的交易余额永远不会用于这些费用。'
                      : 'AI requests and premium data are charged to a dedicated USDC wallet. Your trading balance is never used for these fees.'}
                  </p>
                </div>
                {wallet?.found ? (
                  <div className="frontier-wallet-card">
                    <QRCodeSVG value={wallet.address || ''} size={130} />
                    <div>
                      <b>USDC on Base</b>
                      <p>
                        {zh
                          ? '仅向此 AI 付款地址发送 Base 网络上的 USDC。'
                          : 'Send only USDC on the Base network to this AI payment address.'}
                      </p>
                      <code>{wallet.address}</code>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              wallet.address || ''
                            )
                            setCopied(true)
                          } catch {
                            setError(
                              zh
                                ? '复制失败。请手动选择并复制地址。'
                                : 'Copy failed. Select and copy the address instead.'
                            )
                          }
                        }}
                      >
                        {copied
                          ? zh
                            ? '地址已复制'
                            : 'Address copied'
                          : zh
                            ? '复制 AI 付款地址'
                            : 'Copy AI payment address'}
                      </button>
                      <p role="status">
                        <strong>
                          {wallet.balance_status === 'ok'
                            ? `${Number(wallet.balance_usdc).toFixed(2)} USDC`
                            : zh
                              ? '余额未核实'
                              : 'Balance not verified'}
                        </strong>{' '}
                        ·{' '}
                        {status === 'ready'
                          ? zh
                            ? '资金已到账'
                            : 'Funds received'
                          : status === 'empty'
                            ? zh
                              ? '等待你的存款 · 每 15 秒检查一次'
                              : 'Waiting for your deposit · checks every 15 seconds'
                            : zh
                              ? '需要核实'
                              : 'Verification needed'}
                      </p>
                      <button
                        disabled={working}
                        onClick={() => void refreshWallet()}
                      >
                        {zh ? '检查余额' : 'Check balance'}
                      </button>
                      {!wallet.enabled && (
                        <button
                          disabled={working}
                          onClick={() => void createWallet()}
                        >
                          {zh ? '启用现有 AI 钱包' : 'Enable existing AI wallet'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="frontier-setup-start">
                    <p>
                      {zh
                        ? '创建你的 AI 付款钱包，然后用 Base USDC 为它充值。创建钱包不会收费。'
                        : 'Create your AI payment wallet, then fund it with Base USDC. Creating it does not charge you.'}
                    </p>
                    <button
                      className="planning-primary"
                      disabled={working || !!error || status === 'checking'}
                      onClick={() => void createWallet()}
                    >
                      {working
                        ? zh
                          ? '设置中…'
                          : 'Setting up…'
                        : zh
                          ? '创建 AI 钱包'
                          : 'Create AI wallet'}
                    </button>
                    {error && (
                      <button onClick={() => void refreshWallet()}>
                        {zh ? '检查钱包状态' : 'Check wallet status'}
                      </button>
                    )}
                  </div>
                )}
                {wallet?.found && wallet.address && wallet.model_id && (
                  <AIWalletBackup
                    key={wallet.model_id + wallet.address}
                    modelID={wallet.model_id}
                    address={wallet.address}
                  />
                )}
                <p className="frontier-setup-note">
                  {zh
                    ? '按请求付费；网关会在付款前确认价格。余额为正并不保证足够支付每个请求。此钱包加密存储在你的 NOFX 服务器上，而不是浏览器中。使用上方的私钥备份保存你的密钥。也请备份你的部署。'
                    : 'Pay per request; the gateway checks the price before payment. A positive balance does not guarantee enough funds for every request. This wallet is encrypted on your NOFX server, not in your browser. Use Private key backup above to save your key. Keep a backup of your deployment too.'}
                </p>
                {directProviders.length > 0 && (
                  <button
                    disabled={working}
                    className="frontier-own-ai"
                    onClick={() => setOwnAI(directProviders)}
                  >
                    {zh ? '改用我自己的 API 密钥 →' : 'Use my own API key instead →'}
                  </button>
                )}
                <footer>
                  <button onClick={() => onOpen(null)}>
                    {zh ? '继续浏览' : 'Keep exploring'}
                  </button>
                  <button
                    className="planning-primary"
                    disabled={!aiReady || working}
                    onClick={() => finish('ai')}
                  >
                    {zh ? '使用此 AI 继续' : 'Continue with this AI'}
                  </button>
                </footer>
              </>
            ) : (
              <>
                <p>
                  {zh
                    ? '选择你的订单要发往哪里。连接不会下单，也不会启动 Autopilot。'
                    : 'Choose where your orders will go. Connecting does not place an order or start Autopilot.'}
                </p>
                <div className="frontier-exchange-choices">
                  <button
                    aria-pressed={choice === 'hyperliquid'}
                    onClick={() => setChoice('hyperliquid')}
                  >
                    <b>Hyperliquid</b>
                    <span>{zh ? '连接你的钱包' : 'Connect your wallet'}</span>
                  </button>
                  {apiKeyVenues.map((exchange) => (
                    <button
                      key={exchange}
                      aria-pressed={choice === exchange}
                      onClick={() => setChoice(exchange)}
                    >
                      <b>
                        {venueName(exchange)} {zh ? '合约' : 'Futures'}
                      </b>
                      <span>
                        {zh ? 'API 密钥' : 'API key'}
                        {exchange !== 'binance'
                          ? zh
                            ? ' + 口令'
                            : ' + passphrase'
                          : ''}
                      </span>
                    </button>
                  ))}
                </div>
                {choice === venue && currentAccount && (
                  <div
                    className={
                      exchangeReady
                        ? 'frontier-setup-success'
                        : 'frontier-account-check'
                    }
                    role="status"
                  >
                    <b>
                      {currentAccount.name} ·{' '}
                      {exchangeReady
                        ? zh
                          ? '账户已核实'
                          : 'Account verified'
                        : checked?.status === 'checking'
                          ? zh
                            ? '正在检查交易所…'
                            : 'Checking the exchange…'
                          : zh
                            ? '核实未完成'
                            : 'Verification incomplete'}
                    </b>
                    {exchangeReady ? (
                      <>
                        <p>
                          {zh
                            ? `权益 ${Number(checked.equity).toFixed(2)} · 可用保证金 ${Number(checked.available).toFixed(2)} ${venue === 'hyperliquid' ? 'USDC' : 'USDT'}`
                            : `Equity ${Number(checked.equity).toFixed(2)} · Available margin ${Number(checked.available).toFixed(2)} ${venue === 'hyperliquid' ? 'USDC' : 'USDT'}`}
                        </p>
                        {Number(checked.available) <= 0 && (
                          <p>
                            {zh
                              ? '当前没有可用保证金。你仍可以生成计划；下新订单前，请添加交易资金或释放保证金。'
                              : 'No free margin right now. You can still generate plans; add trading funds or free margin before placing a new order.'}
                          </p>
                        )}
                      </>
                    ) : (
                      <p>
                        {checked?.error ||
                          (zh
                            ? '正在检查凭据并读取实时账户。'
                            : 'Checking credentials and reading the live account.')}
                      </p>
                    )}
                    <button
                      onClick={() => void verifyAccount()}
                      disabled={checked?.status === 'checking'}
                    >
                      {zh ? '核实账户' : 'Verify account'}
                    </button>
                  </div>
                )}
                {choice === 'hyperliquid' ? (
                  currentAccount?.exchange_type === 'hyperliquid' ? (
                    <details className="frontier-wallet-details">
                      <summary>
                        {zh ? '钱包权限与资金' : 'Wallet permissions & funding'}
                      </summary>
                      <HyperliquidWalletConnect
                        key={currentAccount.id}
                        account={{
                          id: currentAccount.id,
                          walletAddress:
                            currentAccount.hyperliquidWalletAddr || '',
                        }}
                        language={zh ? 'zh' : 'en'}
                        isLoggedIn
                        variant="inline"
                        onSaved={savedExchange}
                      />
                    </details>
                  ) : (
                    <HyperliquidWalletConnect
                      language={zh ? 'zh' : 'en'}
                      isLoggedIn
                      variant="inline"
                      onSaved={savedExchange}
                    />
                  )
                ) : (
                  <div className="frontier-setup-start">
                    <b>
                      {zh
                        ? `连接 ${venueName(choice)} USDT 合约`
                        : `Connect ${venueName(choice)} USDT Futures`}
                    </b>
                    <ol>
                      <li>
                        {zh
                          ? '创建一个已启用合约交易的 API 密钥。'
                          : 'Create an API key with Futures trading enabled.'}
                      </li>
                      <li>
                        {zh
                          ? '允许此 NOFX 服务器 IP。保持提现关闭。'
                          : 'Allow this NOFX server IP. Keep withdrawals disabled.'}
                      </li>
                      <li>
                        {zh
                          ? '在此保存密钥。随后我们会核实实时账户。'
                          : 'Save the key here. We then verify the live account.'}
                      </li>
                    </ol>
                    <button
                      className="planning-primary"
                      onClick={() => {
                        setAddingAccount(false)
                        setCex(true)
                      }}
                    >
                      {currentAccount?.exchange_type === choice
                        ? zh
                          ? `更新 ${venueName(choice)} 连接`
                          : `Update ${venueName(choice)} connection`
                        : zh
                          ? `连接 ${venueName(choice)}`
                          : `Connect ${venueName(choice)}`}
                    </button>
                    {currentAccount?.exchange_type === choice && (
                      <button
                        onClick={() => {
                          setAddingAccount(true)
                          setCex(true)
                        }}
                      >
                        {zh
                          ? `再添加一个 ${venueName(choice)} 账户`
                          : `Add another ${venueName(choice)} account`}
                      </button>
                    )}
                  </div>
                )}
                <p className="frontier-setup-note">
                  {zh
                    ? '执行前会再次检查交易权限、余额和订单详情。设置本身不会批准任何交易。'
                    : 'Trading permissions, balances and order details are checked again before execution. Setup does not approve a trade.'}
                </p>
                <footer>
                  <button onClick={() => onOpen(null)}>
                    {currentAccount
                      ? zh
                        ? '关闭'
                        : 'Close'
                      : zh
                        ? '无账户规划'
                        : 'Plan without an account'}
                  </button>
                  <button
                    className="planning-primary"
                    disabled={!exchangeReady || choice !== venue}
                    onClick={() => finish('exchange')}
                  >
                    {zh ? '返回我的计划' : 'Return to my plan'}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
      {cex && (
        <ExchangeConfigModal
          allExchanges={accounts}
          editingExchangeId={
            !addingAccount && currentAccount?.exchange_type === choice
              ? currentAccount.id
              : null
          }
          initialExchangeType={choice}
          allowedExchangeTypes={[choice]}
          language={zh ? 'zh' : 'en'}
          onClose={() => setCex(false)}
          onDelete={() => {}}
          onSave={async (id, type, name, key, secret, passphrase, testnet) => {
            if (!apiKeyVenues.includes(type) || type !== choice || testnet)
              throw new Error(
                zh
                  ? 'Frontier 需要受支持的主网 USDT 合约账户'
                  : 'Frontier requires a supported mainnet USDT futures account'
              )
            if (id) {
              await api.updateExchangeConfigsEncrypted({
                exchanges: {
                  [id]: {
                    enabled: true,
                    api_key: key,
                    secret_key: secret || '',
                    passphrase: passphrase || '',
                    testnet: false,
                  },
                },
              })
              await savedExchange(id)
            } else {
              const result = await api.createExchangeEncrypted({
                exchange_type: type,
                account_name: name,
                enabled: true,
                api_key: key,
                secret_key: secret || '',
                passphrase: passphrase || '',
                testnet: false,
              })
              await savedExchange(result.id)
            }
          }}
        />
      )}
      {ownAI && (
        <ModelConfigModal
          allModels={ownAI}
          configuredModels={models}
          editingModelId={null}
          language={zh ? 'zh' : 'en'}
          onClose={() => setOwnAI(null)}
          onDelete={() => {}}
          onSave={async (id, key, url, name) => {
            try {
              await api.updateModelConfigs({
                models: {
                  [id]: {
                    enabled: true,
                    api_key: key,
                    custom_api_url: url || '',
                    custom_model_name: name || '',
                  },
                },
              })
              const configured = await api.getModelConfigs()
              const match =
                configured.find((m) => m.id === id) ||
                configured.find((m) => m.provider === id && m.enabled)
              await onRefresh(match?.id)
              await refreshWallet()
              setOwnAI(null)
              setError('')
            } catch {
              throw new Error(
                zh ? '无法保存 AI 提供商。' : 'Could not save the AI provider.'
              )
            }
          }}
        />
      )}
    </>
  )
}
