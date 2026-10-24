import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  useApi,
  type Category,
  type Source,
  type SpendingSummary,
  type Transaction,
  type TransactionType,
} from '../lib/useApi'
import { ApiError } from '../lib/api'
import { changeLabel, currentMonth, formatDate, isMonth, money, monthLabel, signedMoney } from '../lib/format'
import { Chips, EmptyState, MonthPicker, PageHeader, ShareBar, Stat, Stats } from '../components/ui'
import { TrendChart } from '../components/TrendChart'
import { FormAlert } from '../components/forms'

const PAGE_SIZE = 50

const TYPE_OPTIONS: { value: TransactionType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'refund', label: 'Refunds' },
  { value: 'unknown', label: 'Not sure' },
]

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

/** Screen 10 — Spending overview: category totals and searchable history. */
export function SpendingPage() {
  const api = useApi()
  const location = useLocation()
  const [params, setParams] = useSearchParams()

  // Filters live in the URL so they survive opening a transaction and coming back.
  const month = isMonth(params.get('month')) ? params.get('month')! : currentMonth()
  const allTime = params.get('scope') === 'all'
  const q = params.get('q') ?? ''
  const categoryId = params.get('category') ?? ''
  const type = (params.get('type') ?? 'all') as TransactionType | 'all'
  const sourceId = params.get('source') ?? ''

  const setParam = (changes: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === '') next.delete(k)
          else next.set(k, v)
        }
        return next
      },
      { replace: true },
    )
  }

  // Search box: type freely, the URL updates after a short pause.
  const [searchText, setSearchText] = useState(q)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText.trim() !== q) setParam({ q: searchText.trim() || null })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  const [categories, setCategories] = useState<Category[]>([])
  const [sources, setSources] = useState<Source[]>([])
  useEffect(() => {
    api.categories().then(setCategories).catch(() => undefined)
    api.sources().then(setSources).catch(() => undefined)
  }, [api])

  // Month summary (category totals, comparison, trend)
  const summaryKey = `${month}|${sourceId}`
  const [summary, setSummary] = useState<{ key: string; data: SpendingSummary | null; error: string | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    api
      .spending(month, sourceId || undefined, controller.signal)
      .then((data) => setSummary({ key: summaryKey, data, error: null }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setSummary({ key: summaryKey, data: null, error: errorText(err, 'We could not load your spending.') })
      })
    return () => controller.abort()
  }, [api, month, sourceId, summaryKey])
  const summaryLoading = summary?.key !== summaryKey
  const s = summaryLoading ? null : summary.data

  // Transaction list (filters + paging)
  const listKey = JSON.stringify({ month: allTime ? null : month, q, categoryId, type, sourceId })
  const [list, setList] = useState<{ key: string; rows: Transaction[]; total: number; error: string | null } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const query = useMemo(
    () => ({
      month: allTime ? undefined : month,
      q: q || undefined,
      categoryId: categoryId || undefined,
      type: type === 'all' ? undefined : type,
      sourceId: sourceId || undefined,
      limit: PAGE_SIZE,
    }),
    [allTime, month, q, categoryId, type, sourceId],
  )
  useEffect(() => {
    const controller = new AbortController()
    api.transactions
      .list(query, controller.signal)
      .then((res) => setList({ key: listKey, rows: res.transactions, total: res.total, error: null }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setList({ key: listKey, rows: [], total: 0, error: errorText(err, 'We could not load your transactions.') })
      })
    return () => controller.abort()
  }, [api, query, listKey])
  const listLoading = list?.key !== listKey
  const rows = listLoading ? [] : list.rows

  async function loadMore() {
    if (!list) return
    setLoadingMore(true)
    try {
      const res = await api.transactions.list({ ...query, offset: list.rows.length })
      setList({ ...list, rows: [...list.rows, ...res.transactions], total: res.total })
    } catch (err) {
      setList({ ...list, error: errorText(err, 'We could not load more transactions.') })
    } finally {
      setLoadingMore(false)
    }
  }

  const filtersActive = Boolean(q || categoryId || type !== 'all' || sourceId)
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? (categoryId === 'none' ? 'No category' : '')
  const top = s?.categories[0]
  const moneyOutHint = s
    ? s.comparison.available && s.comparison.previousMoneyOut !== null
      ? changeLabel(
          s.comparison.previousMoneyOut ? Math.round(((s.moneyOut - s.comparison.previousMoneyOut) / s.comparison.previousMoneyOut) * 100) : null,
          s.comparison.previousMoneyOut,
        )
      : 'No comparison yet'
    : undefined

  const hasAnyData = !s || s.coverage.hasImports || s.transactionCount > 0 || (list?.total ?? 0) > 0 || filtersActive || allTime

  return (
    <div className="page">
      <PageHeader
        eyebrow="Where your money goes"
        title="Spending"
        actions={<MonthPicker month={month} max={currentMonth()} onChange={(m) => setParam({ month: m, scope: null })} />}
      />

      {summary?.error && !summaryLoading && <FormAlert>{summary.error}</FormAlert>}

      {s && !hasAnyData ? (
        <EmptyState
          title={`No transactions for ${monthLabel(month)}`}
          action={
            <Link to="/statements/upload" className="button">
              Upload a statement
            </Link>
          }
        >
          Import a bank statement that covers this month to see your spending by category.
        </EmptyState>
      ) : (
        <>
          {s?.coverage.hasImports && !s.coverage.coversWholeMonth && (
            <p className="preview-banner">
              Partial month: your statements don&apos;t cover all of {monthLabel(month)}, so these totals may be incomplete.
            </p>
          )}

          <Stats label={`Totals for ${monthLabel(month)}`}>
            <Stat label="Money out" value={s ? money(s.moneyOut) : '…'} hint={moneyOutHint} />
            <Stat label="Money in" value={s ? money(s.moneyIn) : '…'} hint={s && s.unclassifiedIn > 0 ? `+ ${money(s.unclassifiedIn)} not marked as income` : undefined} />
            <Stat label="Top category" value={top ? top.name : s ? '—' : '…'} hint={top ? money(top.total) : undefined} />
            <Stat
              label="Transactions"
              value={s ? s.transactionCount : '…'}
              hint={s?.coverage.coversWholeMonth ? 'Whole month covered' : s?.coverage.hasImports ? 'Partial month' : undefined}
              tone={s?.coverage.hasImports && !s.coverage.coversWholeMonth ? 'warn' : undefined}
            />
          </Stats>

          <div className="columns">
            <div className="page">
              <section className="card">
                <div className="card__header">
                  <h2 className="section-title">Categories</h2>
                  {categoryId && (
                    <button type="button" className="link-button small" onClick={() => setParam({ category: null })}>
                      Show all
                    </button>
                  )}
                </div>
                {s && s.categories.length === 0 && <p className="muted">No spending in {monthLabel(month)}.</p>}
                {!s && <p className="muted">Loading…</p>}
                {s && s.categories.length > 0 && (
                  <ul className="list">
                    {s.categories.map((c) => {
                      const id = c.categoryId ?? 'none'
                      const change = changeLabel(c.changePercent, c.previousTotal)
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            className="list-row"
                            aria-current={categoryId === id}
                            onClick={() => setParam({ category: categoryId === id ? null : id, scope: null })}
                          >
                            <span className="list-row__main">
                              <span className="list-row__title">{c.name}</span>
                              <ShareBar share={c.share} label={`${Math.round(c.share * 100)}% of spending`} />
                              <span className="list-row__meta">
                                {Math.round(c.share * 100)}% · {c.count} transaction{c.count === 1 ? '' : 's'}
                                {change ? ` · ${change}` : ''}
                              </span>
                            </span>
                            <span className="list-row__value">{money(c.total)}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {s && !s.comparison.available && s.categories.length > 0 && (
                  <p className="muted small">{s.comparison.reason} Month-to-month changes appear once both months are complete.</p>
                )}
              </section>

              <section className="card">
                <h2 className="section-title">Money out, last 6 months</h2>
                {s ? (
                  <TrendChart
                    title="Money out per month"
                    points={s.trend.map((t) => ({ month: t.month, value: t.moneyOut, coverage: t.coverage }))}
                    selected={month}
                    onSelect={(m) => setParam({ month: m, scope: null })}
                  />
                ) : (
                  <p className="muted">Loading…</p>
                )}
              </section>

              {s && s.recurring.length > 0 && (
                <section className="card">
                  <h2 className="section-title">Possible regular payments</h2>
                  <p className="muted small">An estimate: the same merchant and a similar amount in 3 or more months.</p>
                  <ul className="list">
                    {s.recurring.map((r) => (
                      <li key={r.description} className="list-row">
                        <span className="list-row__main">
                          <span className="list-row__title">{r.description}</span>
                          <span className="list-row__meta">
                            {r.categoryName ?? 'Uncategorised'} · seen in {r.months} months · last {formatDate(r.lastDate)}
                          </span>
                        </span>
                        <span className="list-row__value">
                          ~{money(r.typicalAmountMinor)}
                          <small>per month</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <section className="card stack">
              <div className="card__header card__header--flush">
                <h2 className="section-title">Transactions</h2>
                <Chips
                  label="Period"
                  value={allTime ? 'all' : 'month'}
                  onChange={(v) => setParam({ scope: v === 'all' ? 'all' : null })}
                  options={[
                    { value: 'month', label: monthLabel(month) },
                    { value: 'all', label: 'All time' },
                  ]}
                />
              </div>

              <div className="stack">
                <div className="toolbar">
                  <div className="toolbar__grow">
                    <label htmlFor="spending-search" className="visually-hidden">
                      Search transactions
                    </label>
                    <input
                      id="spending-search"
                      type="search"
                      className="search-input"
                      placeholder={allTime ? 'Search all your transactions' : `Search ${monthLabel(month)}`}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                    />
                  </div>
                  <label className="visually-hidden" htmlFor="spending-category">
                    Category
                  </label>
                  <select
                    id="spending-category"
                    className="field__input field__input--inline"
                    value={categoryId}
                    onChange={(e) => setParam({ category: e.target.value || null })}
                  >
                    <option value="">All categories</option>
                    <option value="none">No category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {sources.length > 1 && (
                    <>
                      <label className="visually-hidden" htmlFor="spending-source">
                        Account
                      </label>
                      <select
                        id="spending-source"
                        className="field__input field__input--inline"
                        value={sourceId}
                        onChange={(e) => setParam({ source: e.target.value || null })}
                      >
                        <option value="">All accounts</option>
                        {sources.map((src) => (
                          <option key={src.id} value={src.id}>
                            {src.bankName}
                            {src.nickname ? ` · ${src.nickname}` : ''}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <Chips label="Type" value={type} onChange={(v) => setParam({ type: v === 'all' ? null : v })} options={TYPE_OPTIONS} />
              </div>

              <p className="muted small" aria-live="polite">
                {listLoading
                  ? 'Loading…'
                  : `${list.total} transaction${list.total === 1 ? '' : 's'}${allTime ? ' in all your history' : ` in ${monthLabel(month)}`}${categoryName ? ` · ${categoryName}` : ''}${q ? ` matching “${q}”` : ''}`}
                {filtersActive && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setSearchText('')
                        setParam({ q: null, category: null, type: null, source: null })
                      }}
                    >
                      Clear filters
                    </button>
                  </>
                )}
              </p>

              {list?.error && !listLoading && <FormAlert>{list.error}</FormAlert>}

              {!listLoading && rows.length === 0 && !list.error && (
                <p className="muted">
                  {filtersActive ? 'No transactions match these filters.' : `No transactions in ${monthLabel(month)}.`}
                  {!allTime && filtersActive && (
                    <>
                      {' '}
                      <button type="button" className="link-button" onClick={() => setParam({ scope: 'all' })}>
                        Search all time
                      </button>
                    </>
                  )}
                </p>
              )}

              {rows.length > 0 && (
                <ul className="list">
                  {rows.map((t) => (
                    <li key={t.id}>
                      <Link to={`/spending/${t.id}`} state={{ from: `${location.pathname}${location.search}` }} className="list-row">
                        <span className="list-row__main">
                          <span className="list-row__title">{t.description}</span>
                          <span className="list-row__meta">
                            {formatDate(t.date)} · {t.categoryName ?? 'Uncategorised'}
                            {t.transactionType === 'transfer' && ' · Transfer'}
                            {t.transactionType === 'refund' && ' · Refund'}
                            {t.excludedFromTotals && ' · Not counted'}
                            {t.source && ` · ${t.source.bankName}${t.source.nickname ? ` ${t.source.nickname}` : ''}`}
                          </span>
                        </span>
                        <span className={`list-row__value ${t.direction === 'inflow' ? 'positive' : ''}`}>
                          {signedMoney(t.amountMinor, t.direction)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {!listLoading && rows.length < list.total && (
                <button type="button" className="button button--ghost button--block" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Show more (${list.total - rows.length} left)`}
                </button>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
