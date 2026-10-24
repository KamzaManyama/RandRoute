import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi, type AiAnswer, type Insights } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { currentMonth, isMonth, money, monthLabel } from '../lib/format'
import { EmptyState, MonthPicker, PageHeader, Stat, Stats } from '../components/ui'
import { FormAlert } from '../components/forms'
import { AiAnswerCard, AiConsentPanel, AiUnavailableNote } from '../components/ai'
import { useProfile } from '../auth/profileContext'

type AiState =
  | { state: 'idle' }
  | { state: 'consent' }
  | { state: 'loading' }
  | { state: 'done'; answer: AiAnswer }
  | { state: 'error'; message: string }

const pct = (n: number | null) => (n === null ? null : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`)

/** Screen 14 — Monthly insights. Opening this page never calls AI. */
export function InsightsPage() {
  const api = useApi()
  const { profile } = useProfile()
  const [params, setParams] = useSearchParams()
  const month = isMonth(params.get('month')) ? params.get('month')! : currentMonth()

  const [loaded, setLoaded] = useState<{ month: string; data: Insights | null; error: string | null } | null>(null)
  const [ai, setAi] = useState<{ month: string } & AiState>({ month, state: 'idle' })

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
  const aiState: AiState = ai.month === month ? ai : { state: 'idle' }
  const aiAvailable = Boolean(profile?.ai.available)

  /** `justConsented` skips the check right after the user agrees (profile state may not have updated yet). */
  async function explain(justConsented = false) {
    if (!justConsented && profile?.ai.consent !== 'granted') {
      setAi({ month, state: 'consent' })
      return
    }
    setAi({ month, state: 'loading' })
    try {
      setAi({ month, state: 'done', answer: await api.insights.explain(month) })
    } catch (err) {
      setAi({ month, state: 'error', message: err instanceof ApiError ? err.message : 'AI explanations are unavailable right now.' })
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="What changed and why"
        title="Insights"
        actions={
          <>
            <MonthPicker month={month} max={currentMonth()} onChange={(m) => setParams({ month: m }, { replace: true })} />
            <Link to={`/insights/ask?month=${month}`} className="button button--ghost">
              Ask a question
            </Link>
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
              <Stat label="Money in" value={money(ins.totals.moneyInMinor)} />
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

            <section className="card stack">
              <div className="card__header card__header--flush">
                <h2 className="section-title">Explain this month</h2>
                {aiAvailable && (
                  <button type="button" className="button" onClick={() => explain()} disabled={aiState.state === 'loading'}>
                    {aiState.state === 'loading' ? 'Thinking…' : 'Explain with AI'}
                  </button>
                )}
              </div>
              {aiAvailable ? (
                <p className="muted small">Only runs when you press the button. Uses the figures on this page — nothing else.</p>
              ) : (
                <AiUnavailableNote />
              )}
            </section>
            {aiState.state === 'consent' && <AiConsentPanel onDone={(granted) => (granted ? void explain(true) : setAi({ month, state: 'idle' }))} />}
            {aiState.state === 'error' && <FormAlert>{aiState.message}</FormAlert>}
            {aiState.state === 'done' && <AiAnswerCard answer={aiState.answer} title={`About ${monthLabel(month)}`} />}

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
