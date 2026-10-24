import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi, type StatementSummary } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { formatDate, formatPeriod } from '../lib/format'
import { FormAlert } from '../components/forms'
import { isReviewing, STATUS_INFO } from './statements/statementStatus'
import './StatementsPage.css'

type Filter = 'all' | 'review' | 'imported' | 'problems'

const FILTERS: { key: Filter; label: string; test: (s: StatementSummary) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'review', label: 'Needs review', test: (s) => isReviewing(s.status) },
  { key: 'imported', label: 'Imported', test: (s) => s.status === 'imported' || s.status === 'partial' },
  { key: 'problems', label: 'Warnings', test: (s) => s.warnings.length > 0 || s.status === 'failed' },
]

/** Screen 05 — Statements overview */
export function StatementsPage() {
  const api = useApi()
  const [statements, setStatements] = useState<StatementSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(() => {
    api.statements
      .list()
      .then((list) => {
        setStatements(list)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'We could not load your statements.'))
  }, [api])

  useEffect(load, [load])

  const visible = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)!.test
    // Cancelled imports saved nothing; keep them out of the default list.
    return (statements ?? []).filter((s) => test(s) && (filter !== 'all' || s.status !== 'cancelled'))
  }, [statements, filter])

  const imported = (statements ?? []).filter((s) => s.status === 'imported' || s.status === 'partial')
  const stats = {
    imported: imported.length,
    saved: imported.reduce((sum, s) => sum + s.transactionCount, 0),
    review: (statements ?? []).filter((s) => isReviewing(s.status)).length,
    warnings: (statements ?? []).filter((s) => s.status !== 'cancelled' && s.warnings.length > 0).length,
  }

  return (
    <div className="statements">
      <header className="statements__header">
        <div>
          <p className="muted">Your imports</p>
          <h1>Statements</h1>
        </div>
        <Link to="/statements/upload" className="button">
          Upload statement
        </Link>
      </header>

      {error && (
        <FormAlert>
          <span>{error}</span>
          <span>
            <button type="button" className="link-button" onClick={load}>
              Try again
            </button>
          </span>
        </FormAlert>
      )}

      {statements === null && !error && (
        <section className="card" role="status">
          <p className="muted">Loading your statements…</p>
        </section>
      )}

      {statements !== null && statements.length === 0 && (
        <section className="card empty-state">
          <h2 className="section-title">No statements yet</h2>
          <p className="muted">
            Upload a bank statement PDF to see your transactions. We read it, you check it, and only then is anything
            saved. The PDF itself is never kept.
          </p>
          <Link to="/statements/upload" className="button">
            Upload your first statement
          </Link>
        </section>
      )}

      {statements !== null && statements.length > 0 && (
        <>
          <section className="card statements__summary" aria-label="Statement totals">
            <div className="statements__stat">
              <span>Imported</span>
              <strong>{stats.imported}</strong>
            </div>
            <div className="statements__stat">
              <span>Saved transactions</span>
              <strong>{stats.saved}</strong>
            </div>
            <div className="statements__stat">
              <span>Needs review</span>
              <strong>{stats.review}</strong>
            </div>
            <div className="statements__stat">
              <span>With warnings</span>
              <strong>{stats.warnings}</strong>
            </div>
          </section>

          <section className="card">
            <div className="statements__toolbar">
              <h2>History</h2>
              <div className="statements__filters" role="group" aria-label="Filter statements">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="filter-chip"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="muted">No statements match this filter.</p>
            ) : (
              <ul className="statements__list">
                {visible.map((s) => {
                  const status = STATUS_INFO[s.status]
                  return (
                    <li key={s.id}>
                      <Link to={`/statements/${s.id}`} className="statement-item statement-item--link">
                        <div className="statement-item__meta">
                          <div className="statement-item__source">
                            <span className="statement-item__bank">{s.bankName}</span>
                            {s.nickname && <small>{s.nickname}</small>}
                          </div>
                          <div className="statement-item__details">
                            <strong>{formatPeriod(s.periodStart, s.periodEnd)}</strong>
                            <small>
                              {s.importedAt ? `Imported ${formatDate(s.importedAt)}` : `Uploaded ${formatDate(s.createdAt)}`}
                            </small>
                          </div>
                        </div>
                        <div className="statement-item__metrics">
                          <span>
                            {isReviewing(s.status)
                              ? `${s.validation.rowCount} rows to check`
                              : `${s.transactionCount} saved transactions`}
                          </span>
                          <span className={`status-badge ${status.tone}`}>{status.label}</span>
                        </div>
                        {s.warnings.length > 0 && s.status !== 'cancelled' && (
                          <ul className="statement-item__warnings">
                            {s.warnings.slice(0, 2).map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
