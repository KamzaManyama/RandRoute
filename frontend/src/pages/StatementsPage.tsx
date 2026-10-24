import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi, type StatementSummary } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { formatDate, formatPeriod } from '../lib/format'
import { FormAlert } from '../components/forms'
import { isReviewing, STATUS_INFO } from './statements/statementStatus'
import { Chips, EmptyState, PageHeader, Stat, Stats } from '../components/ui'
import './statements/statements.css'

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
    <div className="page">
      <PageHeader
        eyebrow="Your imports"
        title="Statements"
        actions={
          <Link to="/statements/upload" className="button">
            Upload statement
          </Link>
        }
      />

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
        <EmptyState
          title="No statements yet"
          action={
            <Link to="/statements/upload" className="button">
              Upload your first statement
            </Link>
          }
        >
          Upload a bank statement PDF to see your transactions. We read it, you check it, and only then is anything
          saved. The PDF itself is never kept.
        </EmptyState>
      )}

      {statements !== null && statements.length > 0 && (
        <>
          <Stats label="Statement totals">
            <Stat label="Imported" value={stats.imported} />
            <Stat label="Saved transactions" value={stats.saved} />
            <Stat label="Needs review" value={stats.review} tone={stats.review > 0 ? "warn" : undefined} />
            <Stat label="With warnings" value={stats.warnings} />
          </Stats>

          <section className="card">
            <div className="card__header">
              <h2 className="section-title">History</h2>
              <Chips label="Filter statements" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.key, label: f.label }))} />
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
