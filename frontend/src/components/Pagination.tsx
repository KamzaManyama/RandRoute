import { pageList } from '../lib/paging'

/**
 * "Showing 26–50 of 124" with Previous / page numbers / Next.
 * Renders nothing when everything fits on one page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  label = 'Pages',
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  label?: string
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const current = Math.min(Math.max(page, 1), pageCount)
  const from = (current - 1) * pageSize + 1
  const to = Math.min(current * pageSize, total)

  return (
    <nav className="pagination" aria-label={label}>
      <p className="pagination__summary muted small" aria-live="polite">
        Showing {from}–{to} of {total}
      </p>
      <div className="pagination__controls">
        <button type="button" className="pagination__button" onClick={() => onChange(current - 1)} disabled={current === 1}>
          ‹ <span className="pagination__word">Previous</span>
        </button>
        {pageList(current, pageCount).map((p, i) =>
          p === '…' ? (
            <span key={`gap${i}`} className="pagination__gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className="pagination__button pagination__number"
              aria-label={`Page ${p}`}
              aria-current={p === current ? 'page' : undefined}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className="pagination__button" onClick={() => onChange(current + 1)} disabled={current === pageCount}>
          <span className="pagination__word">Next</span> ›
        </button>
      </div>
    </nav>
  )
}
