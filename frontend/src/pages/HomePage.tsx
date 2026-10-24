import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ApiError, type DashboardSummary } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useAuth } from '../auth/useAuth'
import { currentMonth, formatDate, money, monthLabel, signedMoney } from '../lib/format'
import { MonthPicker, PageHeader, Stat, Stats } from '../components/ui'
import { FormAlert } from '../components/forms'
import { BellIcon } from '../components/icons'

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

  const loading = !loaded || loaded.month !== month
  const summary = loading ? null : loaded.summary
  const error = loading ? null : loaded.error
  const coverage = summary?.coverage
  const spendingLink = (extra = '') => `/spending?month=${month}${extra}`

  return (
    <div className="page">
      <PageHeader
        eyebrow="Welcome back"
        title={firstName || 'to RandRoute'}
        actions={
          <>
            <MonthPicker month={month} onChange={setMonth} max={currentMonth()} />
            <button type="button" className="icon-button" aria-label="Notifications">
              <BellIcon />
            </button>
          </>
        }
      />

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {coverage && !coverage.hasImports && (
        <section className="card card--dark hero">
          <div>
            <h2>Import your first statement</h2>
            <p>See where your money goes — no bank login needed.</p>
          </div>
          <Link to="/statements/upload" className="button button--ghost">
            Upload a statement
          </Link>
        </section>
      )}

      {coverage?.hasImports && !coverage.coversWholeMonth && (
        <p className="preview-banner">
          Partial month: your imported statements don&apos;t cover all of {monthLabel(month)}, so these totals may be
          incomplete.
        </p>
      )}
      {coverage?.hasWarnings && (
        <p className="preview-banner">Some statements for this month imported with warnings. Check them in Statements.</p>
      )}
      {error && <FormAlert>{error}</FormAlert>}

      <Stats label={`Summary for ${monthLabel(month)}`}>
        <Stat label="Money in" value={summary ? money(summary.moneyIn) : '…'} />
        <Stat label="Money out" value={summary ? money(summary.moneyOut) : '…'} />
        <Stat
          label="Net cash flow"
          value={summary ? money(summary.netCashFlow) : '…'}
          tone={summary && summary.netCashFlow < 0 ? 'negative' : undefined}
        />
        <Stat
          label="Budget remaining"
          value={summary ? (summary.budgetRemaining == null ? 'No budget yet' : money(summary.budgetRemaining)) : '…'}
        />
      </Stats>
      <p className="muted small">
        Based on your imported statements — not a live bank balance.
        {summary && summary.unclassifiedIn > 0 &&
          ` ${money(summary.unclassifiedIn)} came in but isn't marked as income yet, so it's not counted.`}
      </p>

      <div className="columns">
        <section className="card">
          <div className="card__header">
            <h2 className="section-title">Top spending</h2>
            <Link to={spendingLink()} className="text-link small">
              See all
            </Link>
          </div>
          {summary && summary.topCategories.length > 0 ? (
            <ul className="list">
              {summary.topCategories.map((c) => (
                <li key={c.categoryId ?? 'none'}>
                  <Link to={spendingLink(`&category=${c.categoryId ?? 'none'}`)} className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title">{c.name}</span>
                      <span className="list-row__meta">
                        {c.count} transaction{c.count === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="list-row__value">{money(c.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{loading ? 'Loading…' : 'No spending for this month yet.'}</p>
          )}
        </section>

        <section className="card">
          <div className="card__header">
            <h2 className="section-title">Recent transactions</h2>
            <Link to={spendingLink()} className="text-link small">
              See all
            </Link>
          </div>
          {summary && summary.recentTransactions.length > 0 ? (
            <ul className="list">
              {summary.recentTransactions.map((t) => (
                <li key={t.id}>
                  <Link to={`/spending/${t.id}`} state={{ from: '/' }} className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title">{t.description}</span>
                      <span className="list-row__meta">
                        {formatDate(t.date)} · {t.categoryName ?? 'Uncategorised'}
                      </span>
                    </span>
                    <span className={`list-row__value ${t.direction === 'inflow' ? 'positive' : ''}`}>
                      {signedMoney(t.amountMinor, t.direction)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{loading ? 'Loading…' : 'No imported transactions for this month.'}</p>
          )}
        </section>
      </div>
    </div>
  )
}
