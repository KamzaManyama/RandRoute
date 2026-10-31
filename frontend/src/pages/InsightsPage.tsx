import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi, type Insights } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { currentMonth, isMonth, money, monthLabel, savingsRateLabel } from '../lib/format'
import { EmptyState, MonthPicker, PageHeader, Stat, Stats } from '../components/ui'
import { FormAlert } from '../components/forms'
import { AiUnavailableNote } from '../components/ai'
import { HealthCard } from '../components/health'
import { useProfile } from '../auth/profileContext'

const pct = (n: number | null) => (n === null ? null : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`)

/** Screen 14 — Monthly insights. Opening this page never calls AI. */
export function InsightsPage() {
  const api = useApi()
  const { profile } = useProfile()
  const [params, setParams] = useSearchParams()
  const month = isMonth(params.get('month')) ? params.get('month')! : currentMonth()

  const [loaded, setLoaded] = useState<{ month: string; data: Insights | null; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    api.insights
      .get(month)
      .then((r) => !cancelled && setLoaded({ month, data: r.insights, error: null }))
      .catch((err: unknown) => !cancelled && setLoaded({ month, data: null, error: err instanceof ApiError ? err.message : 'We could not load your insights.' }))
    return () => {
      cancelled = true
    }
  }, [api, month])

  const loading = loaded?.month !== month
  const ins = loading ? null : loaded.data
  const aiAvailable = Boolean(profile?.ai.available)

  return (
    <div className="page">
      <PageHeader
        eyebrow="What changed and why"
        title="Insights"
        actions={
          <>
            <MonthPicker month={month} max={currentMonth()} onChange={(m) => setParams({ month: m }, { replace: true })} />
            {aiAvailable && ins && (ins.coverage.hasImports || ins.topCategories.length > 0) && (
              <Link to={`/coach?month=${month}`} state={{ start: true }} className="button">
                Ask the AI coach
              </Link>
            )}
          </>
        }
      />

      {!loading && loaded.error && <FormAlert>{loaded.error}</FormAlert>}
      {loading && <p className="muted" role="status">Working out your insights…</p>}

      {ins && !ins.coverage.hasImports && ins.topCategories.length === 0 ? (
        <EmptyState
          title={`No data for ${monthLabel(month)}`}
          action={
            <Link to="/statements/upload" className="button">
              Upload a statement
            </Link>
          }
        >
          Insights appear once you&apos;ve imported a statement covering this month.
        </EmptyState>
      ) : (
        ins && (
          <>
            <Stats label={`Insights for ${monthLabel(month)}`}>
              <Stat
                label="Money out"
                value={money(ins.totals.moneyOutMinor)}
                hint={ins.comparison.available ? `${pct(ins.totals.moneyOutChangePercent) ?? '—'} vs ${monthLabel(ins.comparison.month)}` : 'No comparison'}
              />
              <Stat label="Money in" value={money(ins.totals.moneyInMinor)} tone="positive" />
              <Stat
                label="Savings rate"
                value={savingsRateLabel(ins.savingsRate.percent)}
                tone={(ins.savingsRate.percent ?? 0) < 0 ? 'negative' : undefined}
                hint="Share of income left after spending"
              />
              <Stat label="Top category" value={ins.topCategories[0]?.name ?? '—'} hint={ins.topCategories[0] ? money(ins.topCategories[0].totalMinor) : undefined} />
              <Stat
                label="Budget"
                value={ins.budget.hasBudget ? (ins.budget.overCount ? `${ins.budget.overCount} over` : 'On track') : 'No budget'}
                tone={ins.budget.overCount ? 'negative' : undefined}
              />
            </Stats>

            {ins.limitations.length > 0 && (
              <section className="preview-banner" aria-label="Limitations">
                <strong>Keep in mind:</strong>
                <ul className="ai-policy">
                  {ins.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </section>
            )}

            <div className="columns">
              <HealthCard health={ins.health} />
              <section className="card stack" aria-labelledby="coverage-title">
                <h2 id="coverage-title" className="section-title">
                  Data coverage
                </h2>
                <ul className="list">
                  <li className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title">Statements for this month</span>
                    </span>
                    <span className="list-row__value">{ins.coverage.statementCount}</span>
                  </li>
                  <li className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title">Whole month covered</span>
                      <span className="list-row__meta">Every day of {monthLabel(month)} is inside an imported statement period</span>
                    </span>
                    <span className={`list-row__value ${ins.coverage.coversWholeMonth ? 'positive' : 'negative'}`}>
                      {ins.coverage.coversWholeMonth ? 'Yes' : 'No'}
                    </span>
                  </li>
                  <li className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title">Imported with warnings</span>
                    </span>
                    <span className={`list-row__value ${ins.coverage.hasWarnings ? 'negative' : ''}`}>{ins.coverage.hasWarnings ? 'Yes' : 'No'}</span>
                  </li>
                  <li className="list-row">
                    <span className="list-row__main">
                      <span className="list-row__title">Debit orders</span>
                      <span className="list-row__meta">{ins.totals.debitOrders.count} this month</span>
                    </span>
                    <span className="list-row__value">{money(ins.totals.debitOrders.total)}</span>
                  </li>
                </ul>
                <Link to="/statements" className="text-link small">
                  Manage statements
                </Link>
              </section>
            </div>

            {!aiAvailable && <AiUnavailableNote />}
            {aiAvailable && (
              <p className="muted small">
                Press <strong>Ask the AI coach</strong> for a plain-language summary, what went well, what to watch and next
                steps. It only uses the figures on this page, and you&apos;ll see exactly what is shared first.
              </p>
            )}

            <div className="columns">
              <section className="card">
                <h2 className="section-title">Biggest changes</h2>
                {!ins.comparison.available ? (
                  <p className="muted">{ins.comparison.reason} Changes appear once both months are complete.</p>
                ) : ins.changes.length === 0 ? (
                  <p className="muted">Spending by category was the same as last month.</p>
                ) : (
                  <ul className="list">
                    {ins.changes.map((c) => (
                      <li key={c.categoryId ?? 'none'}>
                        <Link to={`/spending?month=${month}&category=${c.categoryId ?? 'none'}`} className="list-row">
                          <span className="list-row__main">
                            <span className="list-row__title">{c.name}</span>
                            <span className="list-row__meta">
                              {money(c.totalMinor)} this month · {money(c.previousMinor)} in {monthLabel(ins.comparison.month)}
                            </span>
                          </span>
                          <span className={`list-row__value ${c.changeMinor > 0 ? 'negative' : 'positive'}`}>
                            {c.changeMinor > 0 ? '+' : '−'}
                            {money(Math.abs(c.changeMinor))}
                            <small>{c.changePercent === null ? 'new' : pct(c.changePercent)}</small>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="page">
                <section className="card">
                  <h2 className="section-title">Unusual spending</h2>
                  {!ins.unusualCheck.available ? (
                    <p className="muted">{ins.unusualCheck.reason}</p>
                  ) : ins.unusual.length === 0 ? (
                    <p className="muted">
                      Nothing unusual compared with your last {ins.unusualCheck.historyMonths} complete months.
                    </p>
                  ) : (
                    <ul className="list">
                      {ins.unusual.map((u) => (
                        <li key={u.categoryId ?? 'none'} className="list-row">
                          <span className="list-row__main">
                            <span className="list-row__title">{u.name}</span>
                            <span className="list-row__meta">Usually about {money(u.averageMinor)} a month</span>
                          </span>
                          <span className="list-row__value negative">{money(u.totalMinor)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="card">
                  <h2 className="section-title">Top categories</h2>
                  <ul className="list">
                    {ins.topCategories.map((c) => (
                      <li key={c.categoryId ?? 'none'} className="list-row">
                        <span className="list-row__main">
                          <span className="list-row__title">{c.name}</span>
                          <span className="list-row__meta">
                            {c.count} transaction{c.count === 1 ? '' : 's'}
                            {c.sharePercent !== null && ` · ${c.sharePercent}% of spending`}
                          </span>
                        </span>
                        <span className="list-row__value">{money(c.totalMinor)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </>
        )
      )}
    </div>
  )
}
