import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useProfile } from '../auth/profileContext'
import { useApi } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { formatDate, parseRandInput } from '../lib/format'
import { PageHeader } from '../components/ui'
import { FormAlert, PasswordField, TextField } from '../components/forms'
import { AiPolicyText, AiUnavailableNote } from '../components/ai'

const toText = (minor: number | null | undefined) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2))
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

/** Screen 16 — Profile and privacy settings. */
export function ProfilePage() {
  const { profile } = useProfile()
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  if (!profile) return <FormAlert>We couldn&apos;t load your profile. Refresh to try again.</FormAlert>

  return (
    <div className="page">
      <PageHeader eyebrow="Account" title="Profile & privacy" description={profile.email ?? undefined} />
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <div className="columns">
        <div className="page">
          <DetailsCard key={profile.displayName ?? ''} />
          <EmailCard />
          <AiCard />
        </div>
        <div className="page">
          <ExportCard />
          <DangerCard />
        </div>
      </div>
      <nav className="legal-links" aria-label="Policies">
        <Link to="/privacy">Privacy policy</Link>
        <Link to="/data-retention">Data retention policy</Link>
        <Link to="/cookies">Cookie policy</Link>
      </nav>
      <p className="muted small">
        Deleted data is removed from the app straight away. Our database provider may keep encrypted backups for a
        limited time before they expire.
      </p>
    </div>
  )
}

function DetailsCard() {
  const api = useApi()
  const { profile, setProfile } = useProfile()
  const [name, setName] = useState(profile?.displayName ?? '')
  const [income, setIncome] = useState(toText(profile?.expectedMonthlyIncomeMinor))
  const [budget, setBudget] = useState(toText(profile?.monthlyBudgetTargetMinor))
  const [savings, setSavings] = useState(toText(profile?.savingsTargetMinor))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const read = (text: string) => (text.trim() === '' ? null : /^R?\s*0+([.,]0+)?$/i.test(text.trim()) ? 0 : (parseRandInput(text) ?? undefined))

  async function save(event: FormEvent) {
    event.preventDefault()
    const i = read(income)
    const b = read(budget)
    const s = read(savings)
    const next: Record<string, string> = {}
    if (name.trim().length > 60) next.name = 'Use 60 characters or fewer.'
    if (i === undefined) next.income = 'Enter an amount like 25000.00'
    if (b === undefined) next.budget = 'Enter an amount like 15000.00'
    if (s === undefined) next.savings = 'Enter an amount like 2000.00'
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    setMessage(null)
    try {
      setProfile(await api.profile.update({
          displayName: name.trim() || null,
          expectedMonthlyIncomeMinor: i ?? null,
          monthlyBudgetTargetMinor: b ?? null,
          savingsTargetMinor: s ?? null,
        }))
      setMessage({ tone: 'success', text: 'Saved.' })
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err, 'We could not save your details.') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card stack" onSubmit={save} noValidate>
      <h2 className="section-title">Your details</h2>
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      <TextField label="Name (optional)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={errors.name} hint="Only used to greet you." />
      <TextField label="Currency" value="South African rand (ZAR)" disabled />
      <TextField
        label="Usual monthly income after tax (optional)"
        inputMode="decimal"
        placeholder="e.g. 25000.00"
        value={income}
        onChange={(e) => setIncome(e.target.value)}
        error={errors.income}
        hint="A goal for planning and coaching. Your totals always use the income on your statements."
      />
      <TextField label="Monthly spending target (optional)" inputMode="decimal" placeholder="e.g. 15000.00" value={budget} onChange={(e) => setBudget(e.target.value)} error={errors.budget} />
      <TextField label="Monthly savings target (optional)" inputMode="decimal" placeholder="e.g. 2000.00" value={savings} onChange={(e) => setSavings(e.target.value)} error={errors.savings} />
      <div className="form-actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  )
}

/** Change the sign-in email. The change only happens once the new address is confirmed. */
function EmailCard() {
  const api = useApi()
  const { profile } = useProfile()
  const [open, setOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = profile?.email ?? ''

  function start() {
    setOpen(true)
    setNewEmail('')
    setPassword('')
    setErrors({})
    setError(null)
    setSentTo(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    const email = newEmail.trim().toLowerCase()
    if (!email) next.newEmail = 'Enter your new email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.newEmail = 'Enter a valid email address.'
    else if (email === current.toLowerCase()) next.newEmail = "That's already your email address."
    if (!password) next.password = 'Enter your password.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.profile.changeEmail(email, password)
      setSentTo(result.newEmail)
      setOpen(false)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorText(err, 'We could not change your email. Nothing was changed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack" aria-labelledby="email-title">
      <h2 id="email-title" className="section-title">
        Sign-in email
      </h2>
      <p className="email-current">{current || 'No email on this account'}</p>
      {sentTo && (
        <FormAlert tone="success">
          We&apos;ve sent a confirmation link to <strong>{sentTo}</strong>. Your email changes once you open it — until then,
          keep signing in with {current}. If you also get an email at {current}, open that link too.
        </FormAlert>
      )}
      {open ? (
        <form className="stack" onSubmit={submit} noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <TextField
            label="New email address"
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            error={errors.newEmail}
          />
          <PasswordField
            label="Your current password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint="So we know it's really you."
          />
          <div className="form-actions">
            <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Sending…' : 'Send confirmation link'}
            </button>
          </div>
        </form>
      ) : (
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={start}>
            Change email
          </button>
        </div>
      )}
    </section>
  )
}

function AiCard() {
  const api = useApi()
  const { profile, setProfile } = useProfile()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!profile) return null
  const on = profile.ai.consent === 'granted'

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      setProfile(await api.profile.setAiConsent(!on))
    } catch (err) {
      setError(errorText(err, 'We could not save your choice.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack">
      <div className="card__header card__header--flush">
        <h2 className="section-title">AI explanations</h2>
        <span className={`status-badge ${on ? 'status--good' : 'status--muted'}`}>{on ? 'On' : 'Off'}</span>
      </div>
      <AiPolicyText />
      {profile.ai.consent === 'outdated' && (
        <p className="preview-banner">How AI explanations work has changed since you agreed. Please review and turn it on again if you&apos;re happy.</p>
      )}
      {!profile.ai.available && <AiUnavailableNote />}
      {profile.ai.consentUpdatedAt && <p className="muted small">Last changed {formatDate(profile.ai.consentUpdatedAt)}.</p>}
      {error && <FormAlert>{error}</FormAlert>}
      <div className="form-actions">
        <button type="button" className={`button ${on ? 'button--ghost' : ''}`} onClick={toggle} disabled={busy}>
          {on ? 'Turn off AI explanations' : 'I agree — turn on AI explanations'}
        </button>
      </div>
    </section>
  )
}

function ExportCard() {
  const api = useApi()
  const [busy, setBusy] = useState<null | 'transactions' | 'budgets'>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(file: 'transactions' | 'budgets') {
    setBusy(file)
    setError(null)
    try {
      const blob = await api.profile.export(file)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `randroute-${file}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorText(err, 'We could not prepare your export.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card stack">
      <h2 className="section-title">Export your data</h2>
      <p className="muted">
        Download what RandRoute has saved for you as spreadsheets that open in Excel or Google Sheets. PDFs are never
        stored, so they aren&apos;t included.
      </p>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="form-actions">
        <button type="button" className="button button--ghost" onClick={() => download('transactions')} disabled={busy !== null}>
          {busy === 'transactions' ? 'Preparing…' : 'Download transactions'}
        </button>
        <button type="button" className="button button--ghost" onClick={() => download('budgets')} disabled={busy !== null}>
          {busy === 'budgets' ? 'Preparing…' : 'Download budgets'}
        </button>
      </div>
    </section>
  )
}

function DangerCard() {
  const api = useApi()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<null | 'data' | 'account'>(null)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function open(next: 'data' | 'account') {
    setMode(next)
    setTyped('')
    setPassword('')
    setError(null)
    setFieldErrors({})
    setDone(null)
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (typed !== 'DELETE') {
      setFieldErrors({ confirm: 'Type DELETE in capitals to confirm.' })
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'data') {
        await api.profile.deleteData()
        setDone('All your statements, transactions and budgets have been deleted. Your account is still here.')
        setMode(null)
      } else {
        await api.profile.deleteAccount(password)
        await logout()
        navigate('/', { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fields)
      setError(errorText(err, 'That didn’t work. Nothing was deleted.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack">
      <h2 className="section-title">Delete data</h2>
      {done && <FormAlert tone="success">{done}</FormAlert>}
      <p className="muted">
        To remove one statement and its transactions, open it from{' '}
        <Link to="/statements" className="text-link">
          Statements
        </Link>
        .
      </p>
      {mode === null ? (
        <div className="form-actions">
          <button type="button" className="button button--ghost" onClick={() => open('data')}>
            Delete all financial data
          </button>
          <button type="button" className="button button--danger" onClick={() => open('account')}>
            Delete my account
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={confirm} noValidate>
          <FormAlert>
            {mode === 'data'
              ? 'This permanently deletes every statement, transaction and budget. Your login stays.'
              : 'This permanently deletes your account and everything in it. You will be signed out.'}
          </FormAlert>
          {error && <FormAlert>{error}</FormAlert>}
          <TextField label="Type DELETE to confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} error={fieldErrors.confirm} />
          {mode === 'account' && (
            <PasswordField label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} />
          )}
          <div className="form-actions">
            <button type="button" className="button button--ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            <button type="submit" className="button button--danger" disabled={busy}>
              {busy ? 'Deleting…' : mode === 'data' ? 'Delete all financial data' : 'Delete my account'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
