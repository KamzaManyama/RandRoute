import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApi, type Category, type Direction, type TransactionDetail, type TransactionType } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { formatDate, formatPeriod, parseRandInput, signedMoney } from '../lib/format'
import { PageHeader } from '../components/ui'
import { FormAlert, TextField } from '../components/forms'

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer between my accounts',
  refund: 'Refund',
  unknown: 'Not sure yet',
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

/** Screen 11 — Transaction details: inspect and correct one saved transaction. */
export function TransactionDetailPage() {
  const { id = '' } = useParams()
  const api = useApi()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/spending'

  const [tx, setTx] = useState<TransactionDetail | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.transactions.get(id), api.categories()])
      .then(([t, c]) => {
        setTx(t)
        setCategories(c)
      })
      .catch((err: unknown) => setLoadError(errorText(err, 'We could not load this transaction.')))
  }, [api, id])

  if (loadError) {
    return (
      <div className="page">
        <FormAlert>
          <span>{loadError}</span>
          <span>
            <Link to={from} className="text-link">
              Back to spending
            </Link>
          </span>
        </FormAlert>
      </div>
    )
  }
  if (!tx) return <p className="muted" role="status">Loading transaction…</p>

  /** Save a change and update the screen. Totals recalculate from saved rows. */
  async function save(patch: Parameters<typeof api.transactions.update>[1], local: Partial<TransactionDetail>, message: string) {
    if (!tx) return
    const before = tx
    setTx({ ...tx, ...local })
    setError(null)
    setNotice(null)
    try {
      await api.transactions.update(tx.id, patch)
      setNotice(message)
    } catch (err) {
      setTx(before)
      setError(errorText(err, 'That change could not be saved.'))
      throw err
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.transactions.remove(id)
      navigate(from, { replace: true })
    } catch (err) {
      setError(errorText(err, 'We could not delete this transaction.'))
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  const categoryName = categories.find((c) => c.id === tx.categoryId)?.name ?? tx.categoryName

  return (
    <div className="page detail">
      <PageHeader
        eyebrow={
          <Link to={from} className="text-link">
            ‹ Back to spending
          </Link>
        }
        title={tx.description}
        description={`${formatDate(tx.date)} · ${categoryName ?? 'Uncategorised'}`}
        actions={
          <strong className={`detail__amount ${tx.direction === 'inflow' ? 'positive' : ''}`}>
            {signedMoney(tx.amountMinor, tx.direction)}
          </strong>
        }
      />

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}
      {(tx.transactionType === 'transfer' || tx.excludedFromTotals) && (
        <p className="preview-banner">
          {tx.excludedFromTotals
            ? 'This transaction is not counted in your totals or budgets.'
            : 'Transfers between your own accounts are not counted as income or spending.'}
        </p>
      )}

      <div className="columns">
        <section className="card stack">
          <h2 className="section-title">How it&apos;s counted</h2>
          <div className="field">
            <label htmlFor="tx-category" className="field__label">
              Category
            </label>
            <select
              id="tx-category"
              className="field__input"
              value={tx.categoryId ?? ''}
              onChange={(e) => {
                const value = e.target.value || null
                save({ categoryId: value }, { categoryId: value, categoryName: categories.find((c) => c.id === value)?.name ?? null }, 'Category updated. Your totals are recalculated.').catch(() => undefined)
              }}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-type" className="field__label">
              Type
            </label>
            <select
              id="tx-type"
              className="field__input"
              value={tx.transactionType}
              onChange={(e) => {
                const value = e.target.value as TransactionType
                save({ transactionType: value }, { transactionType: value }, 'Type updated. Your totals are recalculated.').catch(() => undefined)
              }}
            >
              {(Object.keys(TYPE_LABELS) as TransactionType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="field__hint">Transfers and &ldquo;Not sure yet&rdquo; money in aren&apos;t counted as income.</p>
          </div>
          <label className="detail__toggle">
            <input
              type="checkbox"
              checked={!tx.excludedFromTotals}
              onChange={(e) =>
                save(
                  { excludedFromTotals: !e.target.checked },
                  { excludedFromTotals: !e.target.checked },
                  e.target.checked ? 'Counted in your totals again.' : 'No longer counted in your totals.',
                ).catch(() => undefined)
              }
            />
            <span>Count this in my totals and budgets</span>
          </label>
          <NoteEditor note={tx.note} onSave={(note) => save({ note }, { note }, 'Note saved.')} />
        </section>

        <div className="page">
          <section className="card stack">
            <div className="card__header card__header--flush">
              <h2 className="section-title">Details</h2>
              <button type="button" className="button button--ghost button--small" onClick={() => setEditing((v) => !v)}>
                {editing ? 'Close' : 'Correct details'}
              </button>
            </div>
            {editing ? (
              <DetailsEditor
                tx={tx}
                onCancel={() => setEditing(false)}
                onSave={async (patch, local) => {
                  await save(patch, local, 'Details corrected. Your totals are recalculated.')
                  setEditing(false)
                }}
              />
            ) : (
              <dl className="detail__facts">
                <dt>Date</dt>
                <dd>{formatDate(tx.date)}</dd>
                <dt>Description</dt>
                <dd>{tx.description}</dd>
                <dt>Amount</dt>
                <dd>{signedMoney(tx.amountMinor, tx.direction)}</dd>
                <dt>Account</dt>
                <dd>{tx.source ? `${tx.source.bankName}${tx.source.nickname ? ` · ${tx.source.nickname}` : ''}` : '—'}</dd>
                <dt>From statement</dt>
                <dd>
                  {tx.statement ? (
                    <Link to={`/statements/${tx.importId}`} className="text-link">
                      {formatPeriod(tx.statement.periodStart, tx.statement.periodEnd)}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </dl>
            )}
          </section>

          <section className="card stack">
            <h2 className="section-title">Delete</h2>
            <p className="muted">Removes this transaction and updates your totals. The rest of the statement stays.</p>
            {confirmDelete ? (
              <div className="form-actions">
                <span>Delete this transaction? This can&apos;t be undone.</span>
                <button type="button" className="button button--ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button type="button" className="button button--danger" onClick={remove} disabled={busy}>
                  {busy ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            ) : (
              <div>
                <button type="button" className="button button--ghost" onClick={() => setConfirmDelete(true)}>
                  Delete transaction
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function NoteEditor({ note, onSave }: { note: string | null; onSave: (note: string | null) => Promise<void> }) {
  const [value, setValue] = useState(note ?? '')
  const [saving, setSaving] = useState(false)
  const changed = value.trim() !== (note ?? '')
  return (
    <form
      className="field"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        setSaving(true)
        await onSave(value.trim() || null).catch(() => undefined)
        setSaving(false)
      }}
    >
      <label htmlFor="tx-note" className="field__label">
        Note (optional)
      </label>
      <textarea id="tx-note" className="field__input" maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="form-actions">
        <button type="submit" className="button button--small" disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </form>
  )
}

function DetailsEditor({
  tx,
  onSave,
  onCancel,
}: {
  tx: TransactionDetail
  onSave: (patch: Parameters<ReturnType<typeof useApi>['transactions']['update']>[1], local: Partial<TransactionDetail>) => Promise<void>
  onCancel: () => void
}) {
  const [date, setDate] = useState(tx.date)
  const [description, setDescription] = useState(tx.description)
  const [amount, setAmount] = useState((tx.amountMinor / 100).toFixed(2))
  const [direction, setDirection] = useState<Direction>(tx.direction)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function submit(event: FormEvent) {
    event.preventDefault()
    const minor = parseRandInput(amount)
    const next: Record<string, string> = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) next.date = 'Enter a valid date.'
    if (!description.trim()) next.description = 'Enter a description.'
    if (minor === null) next.amount = 'Enter an amount like 1250.00'
    setErrors(next)
    if (Object.keys(next).length || minor === null) return
    await onSave(
      { transactionDate: date, cleanedDescription: description.trim(), amountMinor: minor, direction },
      { date, description: description.trim(), amountMinor: minor, direction },
    ).catch(() => undefined)
  }

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      <TextField label="Amount (R)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} />
      <div className="field--wide">
        <TextField label="Description" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      </div>
      <div className="field field--wide">
        <span className="field__label">Direction</span>
        <div className="chips" role="group" aria-label="Money in or out">
          <button type="button" className="filter-chip" aria-pressed={direction === 'outflow'} onClick={() => setDirection('outflow')}>
            Money out
          </button>
          <button type="button" className="filter-chip" aria-pressed={direction === 'inflow'} onClick={() => setDirection('inflow')}>
            Money in
          </button>
        </div>
      </div>
      <div className="form-actions field--wide">
        <button type="button" className="button button--ghost button--small" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--small">
          Save details
        </button>
      </div>
    </form>
  )
}
