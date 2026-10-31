import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ApiError, type DashboardSummary } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useAuth } from '../auth/useAuth'
import { currentMonth, formatDate, money, monthLabel, savingsRateLabel, signedMoney } from '../lib/format'
import { MonthPicker, PageHeader, Stat, Stats } from '../components/ui'
import { FormAlert } from '../components/forms'
import { HealthCard } from '../components/health'

type Load = { month: string; summary: DashboardSummary | null; error: string | null }

/** Home dashboard: one month's figures, all calculated by the backend from saved transactions. */
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
  const hasData = Boolean(coverage?.hasImports)

  return (
    <div className="page">
      <PageHeader
        eyebrow="Welcome back"
        title={firstName || 'to RandRoute'}
        actions={<MonthPicker month={month} onChange={setMonth} max={currentMonth()} />}
      />

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {coverage && !coverage.hasImports && (
        <section className="card card--dark hero">
          <div>
            <h2>Import your {monthLabel(month)} statement</h2>
            <p>Upload a PDF from FNB, Capitec, Absa, Standard Bank, Nedbank or TymeBank. You check every row before anything is saved.</p>
          </div>
          <Link to="/statements/upload" className="button button--ghost">
            Upload a statement
          </Link>
        </section>
      )}

      {coverage?.hasImports && !coverage.coversWholeMonth && (
        <p className="preview-banner">
          Partial month: your imported statements don&apos;t cover all of {monthLabel(month)}, so these totals may be incomplete.
        </p>
      )}
      {coverage?.hasWarnings && (
        <p className="preview-banner">
          Some statements for this month imported with warnings.{' '}
          <Link to="/statements" className="text-link">
            Check them
          </Link>
        </p>
      )}
      {error && <FormAlert>{error}</FormAlert>}

      <Stats label={`Summary for ${monthLabel(month)}`}>
        <Stat label="Money in" value={summary ? money(summary.moneyIn) : '…'} tone="positive" />
        <Stat label="Money out" value={summary ? money(summary.moneyOut) : '…'} />
        <Stat
          label="Net cash flow"
          value={summary ? money(summary.netCashFlow) : '…'}
          tone={summary && summary.netCashFlow < 0 ? 'negative' : undefined}
        />
        <Stat
          label="Savings rate"
          value={summary ? savingsRateLabel(summary.savingsRate.percent) : '…'}
          tone={summary && (summary.savingsRate.percent ?? 0) < 0 ? 'negative' : undefined}
        />
        <Stat
          label="Budget remaining"
          value={summary ? (summary.budgetRemaining == null ? 'No target set' : money(summary.budgetRemaining)) : '…'}
          tone={summary && (summary.budgetRemaining ?? 0) < 0 ? 'negative' : undefined}
        />
      </Stats>
      <p className="muted small">
        Calculated from your imported statements — not a live bank balance. Transfers between your own accounts aren&apos;t
        counted as income or spending.
        {summary && summary.unclassifiedIn > 0 && (
          <>
            {' '}
            {money(summary.unclassifiedIn)} came in but isn&apos;t marked as income yet, so it&apos;s not counted.{' '}
            <Link to={spendingLink('&type=unknown')} className="text-link">
              Mark it
            </Link>
          </>
        )}
      </p>

      <nav className="quick-actions" aria-label="Quick actions">
        <Link to="/statements/upload" className="quick-action">
          <span className="quick-action__title">Upload statement</span>
          <span className="quick-action__meta">PDF, checked before saving</span>
        </Link>
        <Link to={`/budget?month=${month}`} className="quick-action">
          <span className="quick-action__title">Budget</span>
          <span className="quick-action__meta">
            {summary?.budget.hasBudget
              ? summary.budget.overCount > 0
                ? `${summary.budget.overCount} over limit`
                : 'All within limits'
              : 'Set your limits'}
          </span>
        </Link>
        <Link to={`/coach?month=${month}`} className="quick-action">
          <span className="quick-action__title">AI coach</span>
          <span className="quick-action__meta">Explain my month</span>
        </Link>
        <Link to={spendingLink()} className="quick-action">
          <span className="quick-action__title">Spending</span>
          <span className="quick-action__meta">By category</span>
        </Link>
      </nav>

      {hasData && summary && (
        <div className="columns">
          <HealthCard health={summary.health} />

          <section className="card stack" aria-labelledby="income-title">
            <h2 id="income-title" className="section-title">
              Where money came from
            </h2>
            <ul className="list">
              <li className="list-row">
                <span className="list-row__main">
                  <span className="list-row__title">Salary &amp; wages</span>
                </span>
                <span className="list-row__value positive">{money(summary.income.salary)}</span>
              </li>
              <li className="list-row">
                <span className="list-row__main">
                  <span className="list-row__title">Side hustle &amp; extra income</span>
                  <span className="list-row__meta">Payouts, freelance and other work you marked</span>
                </span>
                <span className="list-row__value positive">{money(summary.income.side)}</span>
              </li>
              <li className="list-row">
                <span className="list-row__main">
                  <span className="list-row__title">Other income</span>
                  <span className="list-row__meta">Grants, interest, refunds from SARS</span>
                </span>
                <span className="list-row__value positive">{money(summary.income.other)}</span>
              </li>
            </ul>
            <div className="divider" />
            <div className="list-row">
              <span className="list-row__main">
                <span className="list-row__title">Debit orders</span>
                <span className="list-row__meta">
                  {summary.debitOrders.count} fixed commitment{summary.debitOrders.count === 1 ? '' : 's'} this month
                </span>
              </span>
              <span className="list-row__value">{money(summary.debitOrders.total)}</span>
            </div>
            {summary.goals.savingsTargetMinor !== null && summary.savingsRate.percent !== null && (
              <p className={summary.goals.savingsTargetMet ? 'small positive' : 'small'}>
                Savings goal {money(summary.goals.savingsTargetMinor)}:{' '}
                {summary.goals.savingsTargetMet ? 'met this month' : `not met — ${money(Math.max(summary.netCashFlow, 0))} left after spending`}
              </p>
            )}
          </section>
        </div>
      )}

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
                        {c.sharePercent !== null && ` · ${c.sharePercent}% of spending`}
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
                        {formatDate(t.date)} · {t.categoryName ?? 'Uncategorised'} · {t.channelLabel}
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
