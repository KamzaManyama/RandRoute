import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi, type BudgetView, type LimitStatus } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { currentMonth, isMonth, money, monthLabel } from '../lib/format'
import { EmptyState, MonthPicker, PageHeader, ShareBar, Stat, Stats } from '../components/ui'
import { FormAlert } from '../components/forms'

const STATUS: Record<LimitStatus, { label: string; tone: string }> = {
  on_track: { label: 'On track', tone: 'status--good' },
  near_limit: { label: 'Near limit', tone: 'status--warn' },
  reached: { label: 'Limit reached', tone: 'status--warn' },
  exceeded: { label: 'Exceeded', tone: 'status--bad' },
}

/** Screen 12 — Monthly budget: limits vs qualifying spending. */
export function BudgetPage() {
  const api = useApi()
  const [params, setParams] = useSearchParams()
  const month = isMonth(params.get('month')) ? params.get('month')! : currentMonth()
  const setMonth = (m: string) => setParams({ month: m }, { replace: true })

  const [view, setView] = useState<{ month: string; data: BudgetView | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.budgets
      .get(month)
      .then((data) => setView({ month, data, error: null }))
      .catch((err: unknown) =>
        setView({ month, data: null, error: err instanceof ApiError ? err.message : 'We could not load your budget.' }),
      )
  }, [api, month])
  useEffect(load, [load])

  const loading = view?.month !== month
  const b = loading ? null : view.data

  async function copyPrevious() {
    setBusy(true)
    setActionError(null)
    try {
      await api.budgets.copyPrevious(month)
      load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'We could not copy last month.')
    } finally {
      setBusy(false)
    }
  }

  const planLink = `/budget/plan?month=${month}`
  const hasPlan = Boolean(b?.budget && b.limits.length > 0)
  const savings = b?.budget?.savingsTargetMinor ?? null
  const income = b?.budget?.expectedIncomeMinor ?? null

  return (
    <div className="page">
      <PageHeader
        eyebrow="Monthly plan"
        title="Budget"
        actions={
          <>
            <MonthPicker month={month} onChange={setMonth} />
            {hasPlan && (
              <Link to={planLink} className="button">
                Edit plan
              </Link>
            )}
          </>
        }
      />

      {!loading && view.error && <FormAlert>{view.error}</FormAlert>}
      {actionError && <FormAlert>{actionError}</FormAlert>}
      {loading && <p className="muted" role="status">Loading your budget…</p>}

      {b && !hasPlan && (
        <EmptyState
          title={`No budget for ${monthLabel(month)}`}
          action={
            <div className="form-actions">
              {b.previousMonthHasBudget && (
                <button type="button" className="button button--ghost" onClick={copyPrevious} disabled={busy}>
                  Copy last month&apos;s budget
                </button>
              )}
              <Link to={planLink} className="button">
                Create a plan
              </Link>
            </div>
          }
        >
          Set a limit for the categories you want to watch. We compare them with the spending from your imported
          statements.
          {b.history.months > 0 && ` We can suggest limits from your last ${b.history.months} complete month${b.history.months === 1 ? '' : 's'}.`}
        </EmptyState>
      )}

      {b && hasPlan && (
        <>
          {!b.coverage.hasImports && (
            <p className="preview-banner">
              No statements cover {monthLabel(month)} yet, so spending shows as R0 — that doesn&apos;t mean you spent
              nothing.
            </p>
          )}
          {b.coverage.hasImports && !b.coverage.coversWholeMonth && (
            <p className="preview-banner">
              Partial month: your statements don&apos;t cover all of {monthLabel(month)}, so spending may be higher than shown.
            </p>
          )}

          <Stats label={`Budget for ${monthLabel(month)}`}>
            <Stat label="Planned" value={money(b.totals.plannedMinor)} hint={`${b.limits.length} categories`} />
            <Stat label="Spent" value={money(b.totals.spentInBudgetMinor)} hint="In budgeted categories" />
            <Stat
              label="Remaining"
              value={money(b.totals.remainingMinor)}
              tone={b.totals.remainingMinor < 0 ? 'negative' : undefined}
              hint={b.totals.remainingMinor < 0 ? 'Over plan' : undefined}
            />
            <Stat
              label="Savings target"
              value={savings === null ? 'Not set' : money(savings)}
              hint={income !== null ? `Expected income ${money(income)}` : undefined}
            />
          </Stats>

          <div className="columns">
            <section className="card">
              <h2 className="section-title">Category limits</h2>
              <ul className="list">
                {b.limits.map((l) => {
                  const status = STATUS[l.status]
                  return (
                    <li key={l.categoryId}>
                      <Link to={`/spending?month=${month}&category=${l.categoryId}`} className="list-row">
                        <span className="list-row__main">
                          <span className="list-row__title">{l.name}</span>
                          <ShareBar
                            share={l.limitMinor ? l.spentMinor / l.limitMinor : 1}
                            label={`${l.limitMinor ? Math.round((l.spentMinor / l.limitMinor) * 100) : 100}% of limit used`}
                          />
                          <span className="list-row__meta">
                            {money(l.spentMinor)} of {money(l.limitMinor)} ·{' '}
                            <span className={`status-badge ${status.tone}`}>{status.label}</span>
                          </span>
                        </span>
                        <span className={`list-row__value ${l.remainingMinor < 0 ? 'negative' : ''}`}>
                          {money(Math.abs(l.remainingMinor))}
                          <small>{l.remainingMinor < 0 ? 'over' : 'left'}</small>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="card">
              <h2 className="section-title">Spending without a limit</h2>
              {b.unbudgeted.length === 0 ? (
                <p className="muted">All of this month&apos;s spending is in budgeted categories.</p>
              ) : (
                <>
                  <ul className="list">
                    {b.unbudgeted.map((u) => (
                      <li key={u.categoryId ?? 'none'}>
                        <Link to={`/spending?month=${month}&category=${u.categoryId ?? 'none'}`} className="list-row">
                          <span className="list-row__main">
                            <span className="list-row__title">{u.name}</span>
                          </span>
                          <span className="list-row__value">{money(u.spentMinor)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="muted small">
                    Total money out this month: {money(b.totals.totalSpendingMinor)}
                    {b.totals.refundsMinor > 0 && ` (after ${money(b.totals.refundsMinor)} in refunds)`}.
                  </p>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
