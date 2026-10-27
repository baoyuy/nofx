import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Eye, EyeOff, Wallet, ArrowRight } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { AIWalletBackup, downloadWalletBackup } from '../common/AIWalletBackup'
import { CLAW402_MODELS, DEFAULT_CLAW402_MODEL } from './model-constants'
import type { Language } from '../../i18n/translations'
import './Claw402ConfigForm.css'

type Phase = 'create' | 'import' | 'backup' | 'fund'
type WalletSource = 'saved' | 'generated' | 'imported'
type WalletDetails = { address: string; key: string; source: WalletSource }

async function walletRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/wallet/${path}`, {
    ...init,
    cache: 'no-store',
    signal: init.signal || AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('Wallet request failed')
  return response.json()
}

export function Claw402ConfigForm({
  apiKey,
  modelName,
  editingModelId,
  walletModelID,
  hasExistingKey,
  initialWalletAddress,
  onApiKeyChange,
  onModelNameChange,
  onBack,
  onSubmit,
  language = 'en',
}: {
  apiKey: string
  modelName: string
  editingModelId: string | null
  walletModelID?: string
  hasExistingKey?: boolean
  initialWalletAddress?: string
  onApiKeyChange: (value: string) => void
  onModelNameChange: (value: string) => void
  onBack: () => void
  onSubmit: (event: FormEvent) => void
  language?: Language
}) {
  const zh = language === 'zh'
  const L = (en: string, zhText: string) => (zh ? zhText : en)
  const [phase, setPhase] = useState<Phase>(hasExistingKey ? 'fund' : 'create')
  const [wallet, setWallet] = useState<WalletDetails | null>(
    hasExistingKey
      ? { address: initialWalletAddress || '', key: '', source: 'saved' }
      : null
  )
  const [importKey, setImportKey] = useState(apiKey)
  const [backedUp, setBackedUp] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [balanceError, setBalanceError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const pending = useRef(false)
  const mounted = useRef(true)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  const model = CLAW402_MODELS.find(
    (item) => item.id === (modelName || DEFAULT_CLAW402_MODEL)
  )
  const address = phase === 'fund' ? wallet?.address : ''
  const canSave =
    phase === 'fund' &&
    Boolean(wallet && (wallet.source === 'saved' || wallet.key === apiKey))

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(copyTimer.current)
    }
  }, [])

  // Keep transient keys in memory only. A reload must not silently discard a
  // generated wallet before the user has had a chance to save its backup.
  useEffect(() => {
    if (wallet?.source !== 'generated') return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [wallet?.source])

  useEffect(() => {
    setBalance(null)
    setBalanceError(false)
    if (!address) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let controller: AbortController
    const check = async () => {
      if (!active) return
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(check, 15000)
        return
      }
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      setChecking(true)
      try {
        const data = await walletRequest(
          `balance?address=${encodeURIComponent(address)}`,
          { signal: controller.signal }
        )
        const value = Number(data.balance_usdc)
        if (
          typeof data.balance_usdc !== 'string' ||
          !data.balance_usdc.trim() ||
          !Number.isFinite(value) ||
          value < 0 ||
          data.address?.toLowerCase() !== address.toLowerCase()
        ) {
          throw new Error('Invalid balance')
        }
        if (active) {
          setBalance(value)
          setBalanceError(false)
        }
      } catch {
        if (active) {
          setBalance(null)
          setBalanceError(true)
        }
      } finally {
        clearTimeout(timeout)
        if (active) {
          setChecking(false)
          timer = setTimeout(check, 15000)
        }
      }
    }
    void check()
    return () => {
      active = false
      clearTimeout(timer)
      controller?.abort()
    }
  }, [address, refresh])

  const prepare = async (source: 'generated' | 'imported') => {
    if (pending.current) return
    const key = importKey.trim()
    if (source === 'imported' && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      setError(
        L(
          'Enter a valid private key: 0x followed by 64 hexadecimal characters.',
          '请输入有效的私钥：0x 后跟 64 个十六进制字符。'
        )
      )
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const data =
        source === 'generated'
          ? await walletRequest('generate', { method: 'POST' })
          : await walletRequest('validate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ private_key: key, derive_only: true }),
            })
      const privateKey = source === 'generated' ? data.private_key : key
      if (
        !/^0x[0-9a-fA-F]{40}$/.test(data.address || '') ||
        !/^0x[0-9a-fA-F]{64}$/.test(privateKey || '') ||
        (source === 'imported' && !data.valid)
      ) {
        throw new Error('Invalid wallet')
      }
      if (!mounted.current) return
      setWallet({ address: data.address, key: privateKey, source })
      setImportKey('')
      setBackedUp(false)
      setRevealed(false)
      setCopied('')
      if (source === 'generated') {
        onApiKeyChange('')
        setPhase('backup')
      } else {
        onApiKeyChange(privateKey)
        setPhase('fund')
      }
    } catch {
      if (mounted.current)
        setError(
          source === 'generated'
            ? L(
                'Could not create a wallet. Check your NOFX connection and try again.',
                '无法创建钱包。请检查 NOFX 连接后重试。'
              )
            : L(
                'Could not import this wallet. Check the private key and your NOFX connection.',
                '无法导入此钱包。请检查私钥和 NOFX 连接。'
              )
        )
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const copy = async (value: string, kind: string) => {
    setError('')
    try {
      await navigator.clipboard.writeText(value)
      if (!mounted.current) return
      setCopied(kind)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(''), 2500)
    } catch {
      if (mounted.current)
        setError(
          L(
            'Clipboard is unavailable. Select and copy the text manually.',
            '剪贴板不可用。请手动选择并复制文本。'
          )
        )
    }
  }

  const startOver = () => {
    setWallet(null)
    setPhase('create')
    setError('')
    setCopied('')
    setRevealed(false)
    setImportKey('')
    onApiKeyChange('')
  }

  const step = phase === 'backup' ? 1 : phase === 'fund' ? 2 : 0
  return (
    <form
      className="ai-wallet-setup"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave && !pending.current) onSubmit(event)
      }}
    >
      <details className="ai-wallet-model">
        <summary>
          <span>
            <small>{L('AI model', 'AI 模型')}</small>
            <strong>{model?.name || modelName || DEFAULT_CLAW402_MODEL}</strong>
          </span>
          <span className="ai-wallet-muted">{L('Change model', '更换模型')}</span>
        </summary>
        <p>
          {L(
            'One AI wallet for every model. Switch models whenever you like.',
            '一个 AI 钱包适用于所有模型，可随时切换模型。'
          )}
        </p>
        <div className="ai-wallet-model-grid">
          {CLAW402_MODELS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === (modelName || DEFAULT_CLAW402_MODEL)}
              onClick={() => onModelNameChange(item.id)}
            >
              <strong>{item.name}</strong>
              <span>
                {zh
                  ? `$${item.priceIn} 输入 · $${item.priceOut} 输出 / 100 万 tokens`
                  : `$${item.priceIn} input · $${item.priceOut} output / 1M tokens`}
              </span>
            </button>
          ))}
        </div>
        <p className="ai-wallet-muted">
          {L(
            'Indicative rates plus a $0.0012 settlement fee per request. The live quote determines the spending limit; usage and model affect the final cost.',
            '参考费率，另加每笔请求 $0.0012 的结算费。实时报价决定消费上限；实际用量和所选模型会影响最终费用。'
          )}
        </p>
      </details>

      {wallet?.source !== 'saved' && (
        <ol
          className="ai-wallet-steps"
          aria-label={L('AI wallet setup progress', 'AI 钱包设置进度')}
        >
          {[
            L('Create wallet', '创建钱包'),
            L('Save private key', '保存私钥'),
            L('Add USDC', '添加 USDC'),
          ].map(
            (label, index) => (
              <li
                key={label}
                aria-current={step === index ? 'step' : undefined}
                data-complete={step > index}
              >
                <span>{step > index ? <Check size={14} /> : index + 1}</span>
                {label}
              </li>
            )
          )}
        </ol>
      )}

      {phase === 'create' && (
        <section className="ai-wallet-welcome">
          <div className="ai-wallet-icon">
            <Wallet size={28} />
          </div>
          <h2>{L('A wallet for your AI.', '为你的 AI 准备一个钱包。')}</h2>
          <p>
            {L(
              'Create a dedicated wallet, save its private key, then add a little USDC on Base to pay for AI and data. No browser wallet or exchange account needed.',
              '创建一个专用钱包，保存好它的私钥，然后在 Base 上添加少量 USDC 来支付 AI 和数据费用。无需浏览器钱包或交易所账户。'
            )}
          </p>
          <button
            className="ai-wallet-primary"
            type="button"
            disabled={busy}
            onClick={() => void prepare('generated')}
          >
            {busy
              ? L('Creating your wallet…', '正在创建钱包…')
              : L('Create my AI wallet', '创建我的 AI 钱包')}
            <ArrowRight size={17} />
          </button>
          <button
            className="ai-wallet-link"
            type="button"
            disabled={busy}
            onClick={() => {
              setPhase('import')
              setError('')
            }}
          >
            {L(
              'I already have a wallet · Import private key',
              '我已有钱包 · 导入私钥'
            )}
          </button>
          {hasExistingKey && (
            <button
              className="ai-wallet-link"
              type="button"
              disabled={busy}
              onClick={() => {
                setWallet({
                  address: initialWalletAddress || '',
                  key: '',
                  source: 'saved',
                })
                setPhase('fund')
              }}
            >
              {L('Keep my saved wallet', '继续使用已保存的钱包')}
            </button>
          )}
          <p className="ai-wallet-caption">
            {L(
              'Creating a wallet is free. No funds move until you use a paid feature.',
              '创建钱包免费。在你使用付费功能之前，资金不会有任何变动。'
            )}
          </p>
        </section>
      )}

      {phase === 'import' && (
        <section className="ai-wallet-panel">
          <h2>{L('Use an existing wallet', '使用已有钱包')}</h2>
          <p>
            {L(
              'Import a dedicated EVM wallet for AI payments on Base.',
              '导入一个专用的 EVM 钱包，用于在 Base 上支付 AI 费用。'
            )}
          </p>
          <label htmlFor="ai-wallet-import">{L('Private key', '私钥')}</label>
          <input
            id="ai-wallet-import"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={importKey}
            onChange={(event) => {
              setImportKey(event.target.value)
              setError('')
            }}
            placeholder="0x…"
            disabled={busy}
          />
          <button
            className="ai-wallet-primary"
            type="button"
            disabled={busy || !importKey.trim()}
            onClick={() => void prepare('imported')}
          >
            {busy
              ? L('Checking wallet…', '正在检查钱包…')
              : L('Continue with this wallet', '使用此钱包继续')}
          </button>
          <button
            className="ai-wallet-link"
            type="button"
            disabled={busy}
            onClick={startOver}
          >
            {L('Create a new wallet instead', '改为创建新钱包')}
          </button>
        </section>
      )}

      {phase === 'backup' && wallet && (
        <section className="ai-wallet-panel">
          <h2>{L('Save your private key.', '保存你的私钥。')}</h2>
          <p>
            {L(
              'This key gives full control of your wallet. Save it in your password manager before adding funds. Keep it private; NOFX support cannot recover it for you.',
              '此密钥可完全控制你的钱包。在添加资金之前，请先将它保存到密码管理器中。请妥善保密；NOFX 客服无法为你恢复它。'
            )}
          </p>
          <label htmlFor="ai-wallet-backup">
            {L('Your private key', '你的私钥')}
          </label>
          <div className="ai-wallet-key">
            <input
              id="ai-wallet-backup"
              type={revealed ? 'text' : 'password'}
              value={wallet.key}
              readOnly
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setRevealed(!revealed)}
              aria-label={
                revealed
                  ? L('Hide private key', '隐藏私钥')
                  : L('Show private key', '显示私钥')
              }
            >
              {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <button
            className="ai-wallet-secondary"
            type="button"
            onClick={() => void copy(wallet.key, 'key')}
          >
            <Copy size={16} />
            {copied === 'key'
              ? L('Private key copied', '私钥已复制')
              : L('Copy private key', '复制私钥')}
          </button>
          <button
            className="ai-wallet-secondary"
            type="button"
            onClick={() => {
              try {
                downloadWalletBackup(wallet.address, wallet.key)
              } catch {
                setError(
                  L(
                    'Download failed. Copy your key to a password manager instead.',
                    '下载失败。请改为将密钥复制到密码管理器中保存。'
                  )
                )
              }
            }}
          >
            {L('Download backup', '下载备份')}
          </button>
          <p className="ai-wallet-caption">
            {L(
              'The backup file contains your private key and is not encrypted. Store it securely.',
              '备份文件包含你的私钥且未加密。请妥善保管。'
            )}
          </p>
          <label className="ai-wallet-check">
            <input
              type="checkbox"
              checked={backedUp}
              onChange={(event) => setBackedUp(event.target.checked)}
            />
            {L(
              'I saved my private key somewhere safe.',
              '我已将私钥保存到安全的地方。'
            )}
          </label>
          <button
            className="ai-wallet-primary"
            type="button"
            disabled={!backedUp}
            onClick={() => {
              onApiKeyChange(wallet.key)
              setRevealed(false)
              setCopied('')
              setPhase('fund')
            }}
          >
            {L('Continue to add USDC', '继续添加 USDC')}
            <ArrowRight size={17} />
          </button>
        </section>
      )}

      {phase === 'fund' && wallet && (
        <section className="ai-wallet-panel">
          <div className="ai-wallet-heading">
            <div>
              <h2>
                {wallet.source === 'saved'
                  ? L('Your AI wallet', '你的 AI 钱包')
                  : L('Add USDC on Base.', '在 Base 上添加 USDC。')}
              </h2>
              <p>
                {L(
                  'For AI and data fees. Your trading funds stay separate.',
                  '用于 AI 和数据费用。你的交易资金与之分开。'
                )}
              </p>
            </div>
            <span className="ai-wallet-network">
              {L('Base network', 'Base 网络')}
            </span>
          </div>
          {address ? (
            <>
              <div className="ai-wallet-deposit">
                <div className="ai-wallet-qr">
                  <QRCodeSVG
                    value={address}
                    size={112}
                    title={L('AI wallet deposit address', 'AI 钱包充值地址')}
                  />
                </div>
                <div>
                  <label>
                    {L('Send USDC to this address', '将 USDC 发送到此地址')}
                  </label>
                  <code>{address}</code>
                  <button
                    className="ai-wallet-secondary"
                    type="button"
                    onClick={() => void copy(address, 'address')}
                  >
                    <Copy size={16} />
                    {copied === 'address'
                      ? L('Address copied', '地址已复制')
                      : L('Copy deposit address', '复制充值地址')}
                  </button>
                </div>
              </div>
              <ol className="ai-wallet-funding-guide">
                <li>
                  {L(
                    'Open Withdraw or Send in your exchange or wallet.',
                    '在你的交易所或钱包中打开「提现」或「发送」。'
                  )}
                </li>
                <li>
                  {L('Select ', '选择 ')}
                  <strong>USDC</strong>
                  {L(' and the ', ' 和 ')}
                  <strong>Base</strong> {L('network.', '网络。')}
                </li>
                <li>
                  {L(
                    'Paste this address and send a small amount to start. Check the sender’s minimum and withdrawal fee.',
                    '粘贴此地址，先发送一小笔金额开始。请确认发送方的最低限额和提现手续费。'
                  )}
                </li>
              </ol>
              <p className="ai-wallet-network-note">
                {L(
                  'Send USDC on Base only. Other networks or assets will not fund this AI wallet.',
                  '请仅在 Base 网络发送 USDC。其他网络或资产无法为此 AI 钱包充值。'
                )}
              </p>
              <div className="ai-wallet-balance" role="status">
                <div>
                  <small>{L('USDC on Base', 'Base 上的 USDC')}</small>
                  <strong>
                    {balance !== null
                      ? `${balance.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDC`
                      : balanceError
                        ? L('Balance unavailable', '余额不可用')
                        : L('Checking balance…', '正在查询余额…')}
                  </strong>
                  <span>
                    {balanceError
                      ? L(
                          'Could not reach Base. You can save and check again later.',
                          '无法连接 Base。你可以先保存，稍后再检查。'
                        )
                      : balance !== null && balance > 0
                        ? L(
                            'Funds detected. Paid requests use this balance.',
                            '已检测到资金。付费请求将使用此余额。'
                          )
                        : L(
                            'Waiting for USDC. Checks automatically every 15 seconds.',
                            '等待 USDC 到账。每 15 秒自动检查一次。'
                          )}
                  </span>
                </div>
                <button
                  className="ai-wallet-secondary"
                  type="button"
                  disabled={checking}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  {checking
                    ? L('Checking…', '检查中…')
                    : L('Check deposit', '检查到账')}
                </button>
              </div>
            </>
          ) : (
            <p role="status">
              {L(
                'The saved wallet address could not be loaded. You can still save model changes without replacing its private key.',
                '无法加载已保存的钱包地址。你仍可保存模型更改，无需更换其私钥。'
              )}
            </p>
          )}
          <AIWalletBackup
            key={wallet.address}
            modelID={walletModelID || editingModelId || undefined}
            address={wallet.address}
            privateKey={wallet.source === 'saved' ? undefined : wallet.key}
          />
          <div className="ai-wallet-finish">
            <button
              className="ai-wallet-primary"
              type="submit"
              disabled={
                !canSave ||
                (wallet.source !== 'saved' &&
                  !(balance !== null && balance > 0))
              }
            >
              {wallet.source === 'saved'
                ? L('Save changes', '保存更改')
                : L('Finish AI setup', '完成 AI 设置')}
              <ArrowRight size={17} />
            </button>
            {wallet.source !== 'saved' &&
              !(balance !== null && balance > 0) && (
                <button
                  className="ai-wallet-link"
                  type="submit"
                  disabled={!canSave}
                >
                  {L('Save wallet and fund later', '保存钱包，稍后再充值')}
                </button>
              )}
          </div>
          <p className="ai-wallet-caption">
            {L(
              'Saving connects AI only. It does not place trades or start Autopilot.',
              '保存仅连接 AI，不会下单交易，也不会启动 Autopilot。'
            )}
          </p>
          <details className="ai-wallet-advanced">
            <summary>{L('Use a different wallet', '使用其他钱包')}</summary>
            <p>
              {L(
                'Your current wallet and its funds remain yours. The replacement is saved only when you finish setup.',
                '你当前的钱包及其资金仍归你所有。只有在你完成设置后，才会保存替换的钱包。'
              )}
            </p>
            <button
              className="ai-wallet-secondary"
              type="button"
              onClick={startOver}
            >
              {L('Set up a different wallet', '设置其他钱包')}
            </button>
          </details>
        </section>
      )}
      {error && (
        <p role="alert" className="ai-wallet-error">
          {error}
        </p>
      )}
      <div className="ai-wallet-custody">
        <strong>{L('Your wallet. Your control.', '你的钱包，你做主。')}</strong>
        <p>
          {L(
            'New wallets are generated by your own NOFX installation. On save, NOFX stores the private key encrypted on your server to sign AI payments. It is not sent to Claw402 or AI providers. Keep a backup; anyone with the key can spend the funds.',
            '新钱包由你自己的 NOFX 实例生成。保存时，NOFX 会将私钥加密存储在你的服务器上，用于签署 AI 支付。它不会发送给 Claw402 或 AI 服务商。请保留备份；任何持有该密钥的人都可以动用其中的资金。'
          )}
        </p>
      </div>
      <button
        className="ai-wallet-link"
        type="button"
        disabled={busy}
        onClick={onBack}
      >
        {editingModelId
          ? L('Cancel', '取消')
          : L('Choose another AI provider', '选择其他 AI 服务商')}
      </button>
    </form>
  )
}
