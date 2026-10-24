import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi, type AiAnswer, type BudgetView, type Category } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { currentMonth, isMonth, money, monthLabel, parseRandInput } from '../lib/format'
import { PageHeader, Stat, Stats } from '../components/ui'
import { FormAlert } from '../components/forms'
import { AiAnswerCard, AiConsentPanel, AiUnavailableNote } from '../components/ai'
import { useProfile } from '../auth/profileContext'

type Row = { key: number; categoryId: string; amount: string }

/** Rand text → cents. Empty → null. "0" allowed. Invalid → undefined. */
function readAmount(text: string): number | null | undefined {
  const t = text.trim()
  if (!t) return null
  if (/^R?\s*0+([.,]0+)?$/i.test(t)) return 0
  return parseRandInput(t) ?? undefined
}

const toText = (minor: number | null | undefined) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2))
/** Round up to the nearest R50 — a friendlier starting limit. */
const roundUp50 = (minor: number) => Math.ceil(minor / 5000) * 5000

let nextKey = 1

/** Screen 13 — Budget planning. All totals are calculated here, never by AI. */
export function BudgetPlanPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [params] = useSearchParams()
  const month = isMonth(params.get('month')) ? params.get('month')! : currentMonth()

  const [view, setView] = useState<BudgetView | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [income, setIncome] = useState('')
  const [savings, setSavings] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ai, setAi] = useState<{ state: 'idle' | 'consent' | 'loading' } | { state: 'done'; answer: AiAnswer } | { state: 'error'; message: string }>({
    state: 'idle',
  })

  useEffect(() => {
    Promise.all([api.budgets.get(month), api.categories()])
      .then(([v, c]) => {
        setView(v)
        setCategories(c)
        setIncome(toText(v.budget?.expectedIncomeMinor))
        setSavings(toText(v.budget?.savingsTargetMinor ?? profile?.savingsTargetMinor))
        setRows(v.limits.map((l) => ({ key: nextKey++, categoryId: l.categoryId, amount: toText(l.limitMinor) })))
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : 'We could not load this budget.'))
    // profile only seeds the savings field once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, month])

  const averages = useMemo(() => new Map((view?.history.averages ?? []).map((a) => [a.categoryId, a.averageMinor])), [view])
  const usable = categories.filter((c) => !['salary', 'other_income', 'transfers', 'refunds'].includes(c.key))
  const used = new Set(rows.map((r) => r.categoryId))

  // Live totals — calculated by the app.
  const planned = rows.reduce((sum, r) => sum + (readAmount(r.amount) ?? 0), 0)
  const savingsMinor = readAmount(savings) ?? 0
  const incomeMinor = readAmount(income)
  const leftOver = typeof incomeMinor === 'number' ? incomeMinor - planned - savingsMinor : null

  function startFromAverages() {
    const fresh = (view?.history.averages ?? []).filter((a) => !used.has(a.categoryId))
    setRows((current) => [
      ...current,
      ...fresh.map((a) => ({ key: nextKey++, categoryId: a.categoryId, amount: toText(roundUp50(a.averageMinor)) })),
    ])
  }

  function addRow() {
    const first = usable.find((c) => !used.has(c.id))
    if (first) setRows((r) => [...r, { key: nextKey++, categoryId: first.id, amount: '' }])
  }

  function validate() {
    const next: Record<string, string> = {}
    if (readAmount(income) === undefined) next.income = 'Enter an amount like 25000.00'
    if (readAmount(savings) === undefined) next.savings = 'Enter an amount like 2000.00'
    rows.forEach((r) => {
      const v = readAmount(r.amount)
      if (v === undefined || v === null) next[`row-${r.key}`] = 'Enter a limit like 1500.00'
    })
    if (rows.length === 0) next.rows = 'Add at least one category limit.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaveError(null)
    if (!validate()) return
    setSaving(true)
    try {
      await api.budgets.save(month, {
        expectedIncomeMinor: readAmount(income) ?? null,
        savingsTargetMinor: readAmount(savings) ?? null,
        limits: rows.map((r) => ({ categoryId: r.categoryId, limitMinor: readAmount(r.amount) as number })),
      })
      navigate(`/budget?month=${month}`)
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors((e) => ({ ...e, ...err.fields }))
        setSaveError(err.message)
      } else setSaveError('We could not save your budget. Nothing was changed.')
      setSaving(false)
    }
  }

  async function askAi(justConsented = false) {
    if (!justConsented && profile?.ai.consent !== 'granted') {
      setAi({ state: 'consent' })
      return
    }
    setAi({ state: 'loading' })
    try {
      const answer = await api.insights.budgetSuggestions(month, {
        expectedIncomeMinor: readAmount(income) ?? null,
        savingsTargetMinor: readAmount(savings) ?? null,
        limits: rows
          .filter((r) => typeof readAmount(r.amount) === 'number')
          .map((r) => ({
            name: categories.find((c) => c.id === r.categoryId)?.name ?? 'Category',
            limitMinor: readAmount(r.amount) as number,
            averageMinor: averages.get(r.categoryId) ?? null,
          })),
      })
      setAi({ state: 'done', answer })
    } catch (err) {
      setAi({ state: 'error', message: err instanceof ApiError ? err.message : 'AI suggestions are unavailable.' })
    }
  }

  if (loadError) return <FormAlert>{loadError}</FormAlert>
  if (!view) return <p className="muted" role="status">Loading…</p>

  return (
    <form className="page" onSubmit={save} noValidate>
      <PageHeader
        eyebrow={
          <>
            <Link to={`/budget?month=${month}`}>Budget</Link> / Plan
          </>
        }
        title={`Plan for ${monthLabel(month)}`}
        description="Your own estimates. Spending is compared with your imported statements."
      />

      {saveError && <FormAlert>{saveError}</FormAlert>}

      <Stats label="Plan totals">
        <Stat label="Planned spending" value={money(planned)} />
        <Stat label="Savings target" value={money(savingsMinor)} />
        <Stat label="Expected income" value={typeof incomeMinor === 'number' ? money(incomeMinor) : 'Not set'} />
        <Stat
          label={leftOver !== null && leftOver < 0 ? 'Over income by' : 'Left over'}
          value={leftOver === null ? '—' : money(Math.abs(leftOver))}
          tone={leftOver !== null && leftOver < 0 ? 'warn' : undefined}
          hint={leftOver !== null && leftOver < 0 ? 'Your plan is more than your expected income' : undefined}
        />
      </Stats>

      <div className="columns">
        <section className="card stack">
          <h2 className="section-title">Income and savings</h2>
          <div className="field">
            <label htmlFor="plan-income" className="field__label">
              Expected income this month (optional)
            </label>
            <input id="plan-income" className="field__input" inputMode="decimal" placeholder="e.g. 25000.00" value={income} onChange={(e) => setIncome(e.target.value)} aria-invalid={errors.income ? true : undefined} />
            {errors.income && <p className="field__error">{errors.income}</p>}
          </div>
          <div className="field">
            <label htmlFor="plan-savings" className="field__label">
              Savings target (optional)
            </label>
            <input id="plan-savings" className="field__input" inputMode="decimal" placeholder="e.g. 2000.00" value={savings} onChange={(e) => setSavings(e.target.value)} aria-invalid={errors.savings ? true : undefined} />
            {errors.savings && <p className="field__error">{errors.savings}</p>}
          </div>

          <h2 className="section-title">AI suggestions (optional)</h2>
          {profile?.ai.available ? (
            <div>
              <button type="button" className="button button--ghost" onClick={() => askAi()} disabled={ai.state === 'loading' || rows.length === 0}>
                {ai.state === 'loading' ? 'Thinking…' : 'Review my plan with AI'}
              </button>
              <p className="muted small">Advice only — it never changes your plan.</p>
            </div>
          ) : (
            <AiUnavailableNote />
          )}
        </section>

        <section className="card stack">
          <div className="card__header card__header--flush">
            <h2 className="section-title">Category limits</h2>
            {view.history.averages.length > 0 && (
              <button type="button" className="button button--ghost button--small" onClick={startFromAverages}>
                Fill from my averages
              </button>
            )}
          </div>
          {view.history.months > 0 ? (
            <p className="muted small">
              Averages come from your last {view.history.months} complete month{view.history.months === 1 ? '' : 's'} of statements.
            </p>
          ) : (
            <p className="muted small">Import full months of statements to see your averages here.</p>
          )}
          {errors.rows && <p className="field__error">{errors.rows}</p>}

          <ul className="list">
            {rows.map((row) => {
              const avg = averages.get(row.categoryId)
              const err = errors[`row-${row.key}`]
              return (
                <li key={row.key} className="list-row plan-row">
                  <div className="plan-row__fields">
                    <select
                      aria-label="Category"
                      className="field__input"
                      value={row.categoryId}
                      onChange={(e) => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, categoryId: e.target.value } : r)))}
                    >
                      {usable
                        .filter((c) => c.id === row.categoryId || !used.has(c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                    <input
                      aria-label={`Limit for ${categories.find((c) => c.id === row.categoryId)?.name ?? 'category'}`}
                      className="field__input"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={row.amount}
                      aria-invalid={err ? true : undefined}
                      onChange={(e) => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove category"
                      onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                    >
                      ×
                    </button>
                  </div>
                  <span className="list-row__meta">
                    {err ? (
                      <span className="field__error">{err}</span>
                    ) : avg !== undefined ? (
                      <>
                        Your average: {money(avg)}{' '}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, amount: toText(roundUp50(avg)) } : r)))}
                        >
                          Use it
                        </button>
                      </>
                    ) : (
                      'No recent spending in this category'
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          <div>
            <button type="button" className="button button--ghost button--small" onClick={addRow} disabled={usable.every((c) => used.has(c.id))}>
              + Add category
            </button>
          </div>
        </section>
      </div>

      {ai.state === 'consent' && <AiConsentPanel onDone={(granted) => (granted ? void askAi(true) : setAi({ state: 'idle' }))} />}
      {ai.state === 'error' && <FormAlert>{ai.message}</FormAlert>}
      {ai.state === 'done' && <AiAnswerCard answer={ai.answer} title="AI suggestions for your plan" />}

      <section className="card form-actions plan-actions">
        <Link to={`/budget?month=${month}`} className="button button--ghost">
          Cancel
        </Link>
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : 'Save plan'}
        </button>
      </section>
    </form>
  )
}
