import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ApiError, type DashboardSummary } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useAuth } from '../auth/useAuth'
import { money, monthLabel, signedMoney, formatDate } from '../lib/format'
import { FormAlert } from '../components/forms'
import { BellIcon } from '../components/icons'
import './HomePage.css'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)
}

type Load = { month: string; summary: DashboardSummary | null; error: string | null }

/** Screen 04 — Home dashboard */
export function HomePage() {
  const api = useApi()
  const { user } = useAuth()
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const firstName = user?.displayName?.trim().split(/\s+/)[0]

  const [month, setMonth] = useState(currentMonth)
  const [loaded, setLoaded] = useState<Load | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .dashboard(month)
      .then((summary) => !cancelled && setLoaded({ month, summary, error: null }))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setLoaded({ month, summary: null, error: err instanceof ApiError ? err.message : 'We could not load your dashboard.' }),
      )
    return () => {
      cancelled = true
    }
  }, [api, month])

  // Derived: still loading if what we have is for a different month.
  const loading = !loaded || loaded.month !== month
  const summary = loading ? null : loaded.summary
  const error = loading ? null : loaded.error
  const coverage = summary?.coverage

  return (
    <div className="home">
      <div className="home__header">
        <div>
          <p className="muted">Welcome back</p>
          <h1>{firstName || 'to RandRoute'}</h1>
        </div>
        <button type="button" className="icon-button" aria-label="Notifications">
          <BellIcon />
        </button>
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {coverage && !coverage.hasImports && (
        <section className="card card--dark home__hero">
          <div>
            <h2>Import your first statement</h2>
            <p className="home__hero-sub">See where your money goes — no bank login needed.</p>
          </div>
          <Link to="/statements/upload" className="button button--ghost">
            Upload a statement
          </Link>
        </section>
      )}

      <section className="card home__month-picker" aria-label="Choose month">
        <button type="button" className="button button--ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          Previous
        </button>
        <h2>{monthLabel(month)}</h2>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={month >= currentMonth()}
        >
          Next
        </button>
      </section>

      {coverage?.hasImports && !coverage.coversWholeMonth && (
        <p className="preview-banner">
          Partial month: your imported statements don&apos;t cover all of {monthLabel(month)}, so these totals may be
          incomplete.
        </p>
      )}
      {coverage?.hasWarnings && (
        <p className="preview-banner">Some statements for this month imported with warnings. Check them in Statements.</p>
      )}

      <section className="card" aria-live="polite">
        <h2 className="home__section-title">Summary</h2>
        {loading && <p className="muted">Loading your monthly summary…</p>}
        {error && <p role="alert">{error}</p>}
        {summary && (
          <div className="home__stats">
            <div className="home__stat">
              <span>Money in</span>
              <strong>{money(summary.moneyIn)}</strong>
            </div>
            <div className="home__stat">
              <span>Money out</span>
              <strong>{money(summary.moneyOut)}</strong>
            </div>
            <div className="home__stat">
              <span>Net cash flow</span>
              <strong className={summary.netCashFlow < 0 ? 'negative' : ''}>{money(summary.netCashFlow)}</strong>
            </div>
            <div className="home__stat">
              <span>Budget remaining</span>
              <strong>{summary.budgetRemaining == null ? 'No budget yet' : money(summary.budgetRemaining)}</strong>
            </div>
          </div>
        )}
        {summary && summary.unclassifiedIn > 0 && (
          <p className="muted">
            {money(summary.unclassifiedIn)} came in but isn&apos;t marked as income yet, so it&apos;s not counted above.
          </p>
        )}
        <p className="muted home__note">Based on your imported statements — not a live bank balance.</p>
      </section>

      <section className="card">
        <h2 className="home__section-title">Top spending categories</h2>
        {summary && summary.topCategories.length > 0 ? (
          <ul className="home__list">
            {summary.topCategories.map((category) => (
              <li key={category.name}>
                <span>{category.name}</span>
                <strong>{money(category.total)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{loading ? '…' : 'No spending for this month yet.'}</p>
        )}
      </section>

      <section className="card">
        <h2 className="home__section-title">Recent transactions</h2>
        {summary && summary.recentTransactions.length > 0 ? (
          <ul className="home__list">
            {summary.recentTransactions.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{t.description}</strong>
                  <small>
                    {formatDate(t.date)} · {t.categoryName ?? 'Uncategorised'}
                  </small>
                </div>
                <strong className={t.direction === 'inflow' ? 'positive' : ''}>
                  {signedMoney(t.amountMinor, t.direction)}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{loading ? '…' : 'No imported transactions for this month.'}</p>
        )}
      </section>
    </div>
  )
}
