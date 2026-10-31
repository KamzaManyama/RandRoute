import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../auth/profileContext'
import { useApi, type AiVerification, type BudgetReviewResult } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { FormAlert } from './forms'

/** What we tell people before they switch AI on. Keep in step with AI_POLICY_VERSION on the backend. */
export function AiPolicyText() {
  return (
    <ul className="ai-policy">
      <li>RandRoute calculates every number itself. AI only explains those numbers in plain language.</li>
      <li>
        When you press an AI button, we send Google&apos;s Gemini service a short summary: your month totals, category
        totals, savings rate, money-health result, budget status and any goals you set. <strong>Never</strong> your
        PDFs, transaction descriptions, account numbers, name or email. You can see exactly what will be sent first.
      </li>
      <li>Every amount in an AI answer is checked against your figures. Anything that doesn&apos;t match is removed.</li>
      <li>AI only runs when you press a button — never just by opening a page.</li>
      <li>Answers are general budgeting guidance, not financial advice, and can be wrong.</li>
      <li>You can switch this off at any time in Profile &amp; privacy.</li>
    </ul>
  )
}

/** Asks for consent in place, the first time someone uses an AI feature. */
export function AiConsentPanel({ onDone }: { onDone?: (granted: boolean) => void }) {
  const api = useApi()
  const { setProfile } = useProfile()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(granted: boolean) {
    setBusy(true)
    setError(null)
    try {
      setProfile(await api.profile.setAiConsent(granted))
      onDone?.(granted)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save your choice.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack ai-consent" aria-labelledby="ai-consent-title">
      <h2 id="ai-consent-title" className="section-title">
        Use the AI coach?
      </h2>
      <AiPolicyText />
      {error && <FormAlert>{error}</FormAlert>}
      <div className="form-actions">
        <button type="button" className="button button--ghost" onClick={() => choose(false)} disabled={busy}>
          No thanks
        </button>
        <button type="button" className="button" onClick={() => choose(true)} disabled={busy}>
          I agree — turn on AI
        </button>
      </div>
    </section>
  )
}

/** The label every AI-written block carries, so it's never mistaken for calculated figures. */
export function AiBadge() {
  return <span className="status-badge status--ai">Written by AI</span>
}

/** How the answer was checked. */
export function AiVerificationNote({ verification, generatedAt }: { verification: AiVerification; generatedAt: string }) {
  const time = new Date(generatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  return (
    <p className="muted small">
      Checked {verification.numbersChecked} figure{verification.numbersChecked === 1 ? '' : 's'} against your
      calculated totals
      {verification.pointsRemoved > 0 &&
        ` · ${verification.pointsRemoved} point${verification.pointsRemoved === 1 ? '' : 's'} removed because the figures didn't match`}
      {' '}· written at {time}. General guidance, not financial advice.
    </p>
  )
}

const LABELS: Record<string, string> = {
  month: 'Month',
  currency: 'Currency',
  coverage: 'Statement coverage',
  income: 'Money in',
  incomeBreakdown: 'Income breakdown',
  incomeNotYetMarked: 'Money in not yet marked as income',
  spending: 'Money out',
  net: 'Net cash flow',
  savingsRatePercent: 'Savings rate (%)',
  topCategories: 'Top categories',
  monthOverMonth: 'Compared with last month',
  unusualIncreases: 'Unusual increases',
  budget: 'Budget status',
  risk: 'Money health',
  debitOrders: 'Debit orders',
  goals: 'Your goals',
  savingOpportunities: 'Saving opportunities',
  limitations: 'Limitations',
  expectedIncome: 'Expected income',
  savingsTarget: 'Savings target',
  totalPlanned: 'Total planned',
  plannedPlusSavings: 'Planned plus savings',
  leftOverAfterPlanAndSavings: 'Left over',
  categories: 'Categories',
}

/** Exactly what was (or will be) sent to the AI, in a collapsible panel. */
export function SharedDataDetails({ data, title = 'Exactly what is shared with the AI' }: { data: Record<string, unknown>; title?: string }) {
  return (
    <details className="shared-data">
      <summary>{title}</summary>
      <dl>
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="shared-data__row">
            <dt>{LABELS[key] ?? key}</dt>
            <dd>{typeof value === 'object' && value !== null ? <pre>{JSON.stringify(value, null, 2)}</pre> : String(value ?? '—')}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">No transaction descriptions, dates of single purchases, account numbers, names or emails.</p>
    </details>
  )
}

/** The AI's review of a draft budget plan. */
export function BudgetReviewCard({ result }: { result: BudgetReviewResult }) {
  return (
    <section className="card stack ai-answer" aria-label="AI suggestions for your plan">
      <div className="card__header card__header--flush">
        <h2 className="section-title">AI suggestions for your plan</h2>
        <AiBadge />
      </div>
      <p>{result.review.summary}</p>
      <ul className="ai-list">
        {result.review.suggestions.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="muted small">Suggestions only — nothing in your plan has been changed.</p>
      <AiVerificationNote verification={result.verification} generatedAt={result.generatedAt} />
      <SharedDataDetails data={result.basedOn} title="What was shared" />
    </section>
  )
}

/** Explains why an AI button isn't available. */
export function AiUnavailableNote() {
  return (
    <div className="alert alert--info" role="status">
      <strong>AI coaching is turned off right now.</strong>
      <span>
        All your figures, insights and budgets still work without it.{' '}
        <Link to="/profile" className="text-link">
          About AI in RandRoute
        </Link>
      </span>
      {import.meta.env.DEV && (
        <span className="small">
          Developer: set <code>AI_ENABLED=true</code> in <code>backend/.env</code> and restart the backend.
        </span>
      )}
    </div>
  )
}
