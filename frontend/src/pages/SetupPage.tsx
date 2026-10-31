import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../auth/profileContext'
import { useApi } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { parseRandInput } from '../lib/format'
import { FormAlert, TextField } from '../components/forms'
import { AuthLayout } from './auth/AuthLayout'

const read = (text: string) => (text.trim() === '' ? null : /^R?\s*0+([.,]0+)?$/i.test(text.trim()) ? 0 : (parseRandInput(text) ?? undefined))

/** Screen 03 — Initial setup. Everything here is optional. */
export function SetupPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { profile, setProfile } = useProfile()
  const [income, setIncome] = useState('')
  const [budget, setBudget] = useState('')
  const [savings, setSavings] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function finish(skip: boolean, event?: FormEvent) {
    event?.preventDefault()
    const i = skip ? null : read(income)
    const b = skip ? null : read(budget)
    const s = skip ? null : read(savings)
    const next: Record<string, string> = {}
    if (i === undefined) next.income = 'Enter an amount like 25000.00, or leave it empty.'
    if (b === undefined) next.budget = 'Enter an amount like 15000.00, or leave it empty.'
    if (s === undefined) next.savings = 'Enter an amount like 2000.00, or leave it empty.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    setError(null)
    try {
      const updated = await api.profile.update({
        setupCompleted: true,
        ...(skip ? {} : { expectedMonthlyIncomeMinor: i ?? null, monthlyBudgetTargetMinor: b ?? null, savingsTargetMinor: s ?? null }),
      })
      setProfile(updated)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save that. Please try again.')
      setSaving(false)
    }
  }

  const name = profile?.displayName?.split(/\s+/)[0]

  return (
    <AuthLayout
      title={name ? `Welcome, ${name}` : 'Welcome to RandRoute'}
      subtitle="Three optional questions, then you're in. You can change these any time in Profile."
    >
      <form className="auth__form" onSubmit={(e) => finish(false, e)} noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <TextField label="Currency" value="South African rand (ZAR)" disabled />
        <TextField
          label="What is your usual monthly income after tax? (optional)"
          inputMode="decimal"
          placeholder="e.g. 25000.00"
          value={income}
          onChange={(e) => setIncome(e.target.value)}
          error={errors.income}
          hint="Used as a goal and for AI coaching. Your real income always comes from your statements."
        />
        <TextField
          label="Roughly how much do you want to spend a month? (optional)"
          inputMode="decimal"
          placeholder="e.g. 15000.00"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          error={errors.budget}
          hint="A rough target — not a full budget. You can plan by category later."
        />
        <TextField
          label="How much would you like to save a month? (optional)"
          inputMode="decimal"
          placeholder="e.g. 2000.00"
          value={savings}
          onChange={(e) => setSavings(e.target.value)}
          error={errors.savings}
        />
        <ul className="ai-policy small">
          <li>Upload bank statement PDFs — no bank login needed.</li>
          <li>We read each PDF, you check the rows, and only then is anything saved. PDFs are never kept.</li>
          <li>If your statements don&apos;t cover a whole month, we label the totals as partial.</li>
        </ul>
        <button type="submit" className="button button--block" disabled={saving}>
          {saving ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" className="link-button" onClick={() => finish(true)} disabled={saving}>
          Skip for now
        </button>
      </form>
    </AuthLayout>
  )
}
