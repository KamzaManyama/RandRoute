import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  useApi,
  type Category,
  type ReviewRow,
  type RowPatch,
  type SavedRow,
  type StatementDetail,
  type TransactionType,
  type UploadResult,
} from '../../lib/useApi'
import { ApiError } from '../../lib/api'
import { formatDate, formatPeriod, money, parseRandInput, signedMoney } from '../../lib/format'
import { FormAlert, TextField } from '../../components/forms'
import { STATUS_INFO } from './statementStatus'
import './statements.css'

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer (own accounts)',
  refund: 'Refund',
  unknown: 'Not sure yet',
}

type Tab = 'attention' | 'duplicates' | 'all' | 'excluded'

const willImport = (r: ReviewRow) => r.include && r.duplicateDecision !== 'exclude'
const needsAttention = (r: ReviewRow) =>
  r.reviewStatus === 'needs_review' || r.duplicateDecision === 'unresolved'

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback
}

/** Screens 08–09 — Review rows, resolve duplicates, confirm. Also shows imported statements. */
export function StatementDetailPage() {
  const { id = '' } = useParams()
  const api = useApi()
  const navigate = useNavigate()
  const location = useLocation()
  const navState = location.state as { justUploaded?: UploadResult; notice?: string } | null

  const [detail, setDetail] = useState<StatementDetail | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'confirm' | 'cancel' | 'delete' | 'acceptAll'>(null)
  const [confirming, setConfirming] = useState<null | 'cancel' | 'delete'>(null)
  const [tab, setTab] = useState<Tab | null>(null)

  const load = useCallback(() => {
    Promise.all([api.statements.get(id), api.categories()])
      .then(([d, c]) => {
        setDetail(d)
        setCategories(c)
        setLoadError(null)
      })
      .catch((err: unknown) => setLoadError(errorText(err, 'We could not load this statement.')))
  }, [api, id])

  useEffect(load, [load])

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  if (loadError) {
    return (
      <div className="page">
        <FormAlert>
          <span>{loadError}</span>
          <span>
            <Link to="/statements" className="auth__link">
              Back to statements
            </Link>
          </span>
        </FormAlert>
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="page" role="status">
        <p className="muted">Loading statement…</p>
      </div>
    )
  }

  const { statement } = detail
  const status = STATUS_INFO[statement.status]

  async function removeImport() {
    setBusy('delete')
    setActionError(null)
    try {
      await api.statements.remove(id)
      navigate('/statements', { replace: true })
    } catch (err) {
      setActionError(errorText(err, 'We could not delete this statement.'))
      setBusy(null)
      setConfirming(null)
    }
  }

  return (
    <div className="page review">
      <header className="page-header">
        <div>
          <p className="muted">
            <Link to="/statements" className="auth__link">
              Statements
            </Link>{' '}
            / {statement.bankName}
          </p>
          <h1>
            {statement.bankName}
            {statement.nickname ? ` · ${statement.nickname}` : ''}
          </h1>
          <p className="muted">{formatPeriod(statement.periodStart, statement.periodEnd)}</p>
        </div>
        <span className={`status-badge ${status.tone}`}>{status.label}</span>
      </header>

      {navState?.justUploaded && detail.reviewing && (
        <FormAlert tone="success">
          <span>
            We found <strong>{navState.justUploaded.rowCount}</strong> transactions.{' '}
            {navState.justUploaded.needsReview > 0
              ? `${navState.justUploaded.needsReview} need a quick check before you import.`
              : 'Everything looks good — check the list and confirm.'}
          </span>
        </FormAlert>
      )}
      {navState?.notice && <FormAlert tone="success">{navState.notice}</FormAlert>}
      {actionError && <FormAlert>{actionError}</FormAlert>}

      <ValidationPanel detail={detail} />

      {detail.reviewing ? (
        <ReviewSection
          key={statement.id}
          detail={detail}
          categories={categories}
          tab={tab}
          setTab={setTab}
          busy={busy}
          setBusy={setBusy}
          setActionError={setActionError}
          confirmingCancel={confirming === 'cancel'}
          setConfirming={setConfirming}
          onChanged={setDetail}
          reload={load}
        />
      ) : (
        <SavedSection rows={detail.rows} categoryName={categoryName} />
      )}

      {!detail.reviewing && statement.status !== 'cancelled' && (
        <section className="card danger-zone">
          <div>
            <h2 className="section-title">Delete this import</h2>
            <p className="muted">
              Removes the {statement.transactionCount} transactions saved from this statement and updates your totals.
            </p>
          </div>
          {confirming === 'delete' ? (
            <div className="danger-zone__confirm">
              <span>Delete {statement.transactionCount} transactions? This can&apos;t be undone.</span>
              <button type="button" className="button button--ghost" onClick={() => setConfirming(null)}>
                Keep them
              </button>
              <button type="button" className="button button--danger" onClick={removeImport} disabled={busy === 'delete'}>
                {busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          ) : (
            <button type="button" className="button button--ghost" onClick={() => setConfirming('delete')}>
              Delete import
            </button>
          )}
        </section>
      )}
      {!detail.reviewing && statement.status === 'cancelled' && (
        <section className="card">
          <p className="muted">This import was cancelled, so nothing from it was saved.</p>
          <button type="button" className="button button--ghost" onClick={removeImport}>
            Remove from history
          </button>
        </section>
      )}
    </div>
  )
}

function ValidationPanel({ detail }: { detail: StatementDetail }) {
  const v = detail.statement.validation
  const warnings = detail.statement.warnings
  const checks = [
    {
      label: 'Running balance',
      value:
        v.balanceCheck === 'passed'
          ? 'Every row matches'
          : v.balanceCheck === 'mismatch'
            ? `${v.mismatchedRows} row(s) don't match`
            : 'Not available',
      tone: v.balanceCheck === 'passed' ? 'status--good' : v.balanceCheck === 'mismatch' ? 'status--warn' : 'status--muted',
    },
    {
      label: 'Opening → closing balance',
      value: v.totalsCheck === 'passed' ? 'Adds up' : v.totalsCheck === 'failed' ? "Doesn't add up" : 'Not available',
      tone: v.totalsCheck === 'passed' ? 'status--good' : v.totalsCheck === 'failed' ? 'status--warn' : 'status--muted',
    },
  ]
  if (detail.statement.status === 'cancelled') return null
  return (
    <section className="card validation">
      <div className="validation__checks">
        {checks.map((c) => (
          <div key={c.label} className="validation__check">
            <span className="muted">{c.label}</span>
            <span className={`status-badge ${c.tone}`}>{c.value}</span>
          </div>
        ))}
        {v.openingBalanceMinor !== null && (
          <div className="validation__check">
            <span className="muted">Opening balance</span>
            <strong>{money(v.openingBalanceMinor)}</strong>
          </div>
        )}
        {v.closingBalanceMinor !== null && (
          <div className="validation__check">
            <span className="muted">Closing balance</span>
            <strong>{money(v.closingBalanceMinor)}</strong>
          </div>
        )}
      </div>
      {warnings.length > 0 && (
        <ul className="statement-item__warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p className="muted validation__note">
        Balances come from the statement itself — this is not a live bank balance.
      </p>
    </section>
  )
}

type ReviewProps = {
  detail: Extract<StatementDetail, { reviewing: true }>
  categories: Category[]
  tab: Tab | null
  setTab: (t: Tab) => void
  busy: null | 'confirm' | 'cancel' | 'delete' | 'acceptAll'
  setBusy: (b: ReviewProps['busy']) => void
  setActionError: (e: string | null) => void
  confirmingCancel: boolean
  setConfirming: (c: null | 'cancel' | 'delete') => void
  onChanged: (d: StatementDetail) => void
  reload: () => void
}

function ReviewSection(props: ReviewProps) {
  const { detail, categories, busy, setBusy, setActionError, onChanged } = props
  const api = useApi()
  const navigate = useNavigate()
  const rows = detail.rows
  const id = detail.statement.id

  const attention = rows.filter(needsAttention)
  const duplicates = rows.filter((r) => r.duplicateOf)
  const unresolved = rows.filter((r) => r.duplicateDecision === 'unresolved' && r.include)
  const excluded = rows.filter((r) => !willImport(r))
  const included = rows.filter(willImport)
  const moneyIn = included.filter((r) => r.direction === 'inflow').reduce((s, r) => s + r.amountMinor, 0)
  const moneyOut = included.filter((r) => r.direction === 'outflow').reduce((s, r) => s + r.amountMinor, 0)

  const tab: Tab = props.tab ?? (attention.length > 0 ? 'attention' : 'all')
  const shown =
    tab === 'attention' ? attention : tab === 'duplicates' ? duplicates : tab === 'excluded' ? excluded : rows

  const setRows = (next: ReviewRow[]) => onChanged({ ...detail, rows: next })

  async function updateRow(row: ReviewRow, patch: RowPatch, local: Partial<ReviewRow>) {
    const before = rows
    const touched: Partial<ReviewRow> = { ...local }
    if (row.reviewStatus === 'needs_review' && patch.duplicateDecision === undefined) {
      touched.reviewStatus = patch.include !== undefined && Object.keys(patch).length === 1 ? 'user_confirmed' : 'user_edited'
    }
    setRows(rows.map((r) => (r.id === row.id ? { ...r, ...touched } : r)))
    setActionError(null)
    try {
      await api.statements.updateRow(id, row.id, patch)
    } catch (err) {
      setRows(before)
      setActionError(errorText(err, 'That change could not be saved.'))
    }
  }

  async function acceptAll() {
    setBusy('acceptAll')
    try {
      await api.statements.acceptAll(id)
      setRows(rows.map((r) => (r.reviewStatus === 'needs_review' && !r.duplicateOf ? { ...r, reviewStatus: 'user_confirmed' } : r)))
    } catch (err) {
      setActionError(errorText(err, 'We could not update the rows.'))
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    setBusy('confirm')
    setActionError(null)
    try {
      const { saved } = await api.statements.confirm(id)
      navigate(`/statements/${id}`, {
        replace: true,
        state: { notice: `Imported ${saved} transaction${saved === 1 ? '' : 's'}. Your totals are updated.` },
      })
      props.reload()
    } catch (err) {
      setActionError(errorText(err, 'We could not import this statement. Nothing was saved.'))
    } finally {
      setBusy(null)
    }
  }

  async function cancelImport() {
    setBusy('cancel')
    try {
      await api.statements.cancel(id)
      navigate('/statements', { replace: true })
    } catch (err) {
      setActionError(errorText(err, 'We could not cancel this import.'))
      setBusy(null)
    }
  }

  return (
    <>
      <PeriodEditor detail={detail} onSaved={props.reload} />

      <section className="card review__summary" aria-label="Import summary">
        <div className="statements__stat">
          <span>Will be imported</span>
          <strong>{included.length}</strong>
        </div>
        <div className="statements__stat">
          <span>Need a check</span>
          <strong>{attention.length}</strong>
        </div>
        <div className="statements__stat">
          <span>Money in</span>
          <strong className="positive">{money(moneyIn)}</strong>
        </div>
        <div className="statements__stat">
          <span>Money out</span>
          <strong className="negative">{money(moneyOut)}</strong>
        </div>
      </section>

      <section className="card">
        <div className="statements__toolbar">
          <h2>Transactions</h2>
          <div className="statements__filters" role="group" aria-label="Show transactions">
            {(
              [
                ['attention', `Needs a check (${attention.length})`],
                ['duplicates', `Possible duplicates (${duplicates.length})`],
                ['all', `All (${rows.length})`],
                ['excluded', `Excluded (${excluded.length})`],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button key={key} type="button" className="filter-chip" aria-pressed={tab === key} onClick={() => props.setTab(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="muted">
            {tab === 'attention' ? 'Nothing needs checking. 🎉' : tab === 'duplicates' ? 'No possible duplicates.' : 'No rows here.'}
          </p>
        ) : (
          <ul className="review__rows">
            {shown.map((row) => (
              <ReviewRowItem key={row.id} row={row} categories={categories} onUpdate={updateRow} />
            ))}
          </ul>
        )}
      </section>

      <section className="card review__footer">
        <div>
          <strong>
            {included.length} transaction{included.length === 1 ? '' : 's'} will be saved
          </strong>
          <p className="muted">
            {excluded.length > 0 ? `${excluded.length} excluded. ` : ''}
            {unresolved.length > 0
              ? `Decide on ${unresolved.length} possible duplicate${unresolved.length === 1 ? '' : 's'} first.`
              : 'Nothing is saved until you confirm.'}
          </p>
        </div>
        <div className="review__actions">
          {props.confirmingCancel ? (
            <>
              <span>Cancel this import? Nothing will be saved.</span>
              <button type="button" className="button button--ghost" onClick={() => props.setConfirming(null)}>
                Keep reviewing
              </button>
              <button type="button" className="button button--danger" onClick={cancelImport} disabled={busy === 'cancel'}>
                Yes, cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button--ghost" onClick={() => props.setConfirming('cancel')}>
                Cancel import
              </button>
              {attention.some((r) => r.reviewStatus === 'needs_review' && !r.duplicateOf) && (
                <button type="button" className="button button--ghost" onClick={acceptAll} disabled={busy !== null}>
                  Mark all as checked
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={confirm}
                disabled={busy !== null || unresolved.length > 0 || included.length === 0}
              >
                {busy === 'confirm' ? 'Importing…' : `Import ${included.length} transactions`}
              </button>
            </>
          )}
        </div>
      </section>
    </>
  )
}

function ReviewRowItem({
  row,
  categories,
  onUpdate,
}: {
  row: ReviewRow
  categories: Category[]
  onUpdate: (row: ReviewRow, patch: RowPatch, local: Partial<ReviewRow>) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const unchecked = row.reviewStatus === 'needs_review'
  const excluded = !willImport(row)
  const lowExtraction = (row.extractionConfidence ?? 1) < 0.75
  const lowCategory = (row.categoryConfidence ?? 1) < 0.6

  return (
    <li className={`review-row${unchecked ? ' review-row--attention' : ''}${excluded ? ' review-row--excluded' : ''}`}>
      <div className="review-row__main">
        <label className="review-row__include">
          <input
            type="checkbox"
            checked={row.include && row.duplicateDecision !== 'exclude'}
            disabled={row.duplicateDecision === 'unresolved'}
            onChange={(e) =>
              onUpdate(row, { include: e.target.checked }, { include: e.target.checked })
            }
          />
          <span className="visually-hidden">Import {row.description}</span>
        </label>
        <div className="review-row__text">
          <strong>{row.description}</strong>
          <small className="muted">{formatDate(row.date)}</small>
        </div>
        <strong className={`review-row__amount ${row.direction === 'inflow' ? 'positive' : ''}`}>
          {signedMoney(row.amountMinor, row.direction)}
        </strong>
      </div>

      <div className="review-row__controls">
        <select
          aria-label={`Category for ${row.description}`}
          className="field__input review-row__select"
          value={row.categoryId ?? ''}
          onChange={(e) => onUpdate(row, { categoryId: e.target.value || null }, { categoryId: e.target.value || null, categoryConfidence: 1 })}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label={`Type for ${row.description}`}
          className="field__input review-row__select"
          value={row.transactionType}
          onChange={(e) => {
            const value = e.target.value as TransactionType
            void onUpdate(row, { transactionType: value }, { transactionType: value, categoryConfidence: 1 })
          }}
        >
          {(Object.keys(TYPE_LABELS) as TransactionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="button" className="button button--ghost button--small" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close' : 'Edit'}
        </button>
      </div>

      {unchecked && (
        <p className="review-row__why">
          {lowExtraction && 'The amount or direction didn’t match the running balance — please check it. '}
          {!lowExtraction && lowCategory && 'We weren’t sure about the category or type. '}
          {row.duplicateOf && 'This might already be saved from another statement.'}
          {!row.duplicateOf && (
            <button
              type="button"
              className="link-button"
              onClick={() => onUpdate(row, { reviewed: true }, { reviewStatus: 'user_confirmed' })}
            >
              Looks right
            </button>
          )}
        </p>
      )}

      {row.duplicateOf && (
        <div className="duplicate">
          <p>
            <strong>Possible duplicate</strong> of a saved transaction: {formatDate(row.duplicateOf.date)} ·{' '}
            {row.duplicateOf.description} · {signedMoney(row.duplicateOf.amountMinor, row.duplicateOf.direction)}
          </p>
          <p className="muted">{row.duplicateOf.reason}</p>
          <div className="duplicate__actions" role="group" aria-label="Duplicate decision">
            <button
              type="button"
              className="filter-chip"
              aria-pressed={row.duplicateDecision === 'exclude'}
              onClick={() => onUpdate(row, { duplicateDecision: 'exclude' }, { duplicateDecision: 'exclude', include: false, reviewStatus: 'user_confirmed' })}
            >
              It&apos;s a duplicate — skip it
            </button>
            <button
              type="button"
              className="filter-chip"
              aria-pressed={row.duplicateDecision === 'keep_both'}
              onClick={() => onUpdate(row, { duplicateDecision: 'keep_both' }, { duplicateDecision: 'keep_both', include: true, reviewStatus: 'user_confirmed' })}
            >
              Keep both
            </button>
          </div>
        </div>
      )}

      {editing && <RowEditor row={row} onCancel={() => setEditing(false)} onSave={async (patch, local) => {
        await onUpdate(row, patch, local)
        setEditing(false)
      }} />}
    </li>
  )
}

function RowEditor({
  row,
  onSave,
  onCancel,
}: {
  row: ReviewRow
  onSave: (patch: RowPatch, local: Partial<ReviewRow>) => Promise<void>
  onCancel: () => void
}) {
  const [date, setDate] = useState(row.date)
  const [description, setDescription] = useState(row.description)
  const [amount, setAmount] = useState((row.amountMinor / 100).toFixed(2))
  const [direction, setDirection] = useState(row.direction)
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
      { date, description: description.trim(), amountMinor: minor, direction, extractionConfidence: 1 },
    )
  }

  return (
    <form className="row-editor" onSubmit={submit} noValidate>
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      <TextField
        label="Description"
        value={description}
        maxLength={200}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
      />
      <TextField label="Amount (R)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} />
      <div className="field">
        <span className="field__label">Direction</span>
        <div className="statements__filters" role="group" aria-label="Money in or out">
          <button type="button" className="filter-chip" aria-pressed={direction === 'outflow'} onClick={() => setDirection('outflow')}>
            Money out
          </button>
          <button type="button" className="filter-chip" aria-pressed={direction === 'inflow'} onClick={() => setDirection('inflow')}>
            Money in
          </button>
        </div>
      </div>
      <div className="row-editor__actions">
        <button type="button" className="button button--ghost button--small" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--small">
          Save
        </button>
      </div>
    </form>
  )
}

function PeriodEditor({ detail, onSaved }: { detail: StatementDetail; onSaved: () => void }) {
  const api = useApi()
  const s = detail.statement
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(s.periodStart)
  const [end, setEnd] = useState(s.periodEnd)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!start || !end || end < start) {
      setError('The end date must be on or after the start date.')
      return
    }
    try {
      await api.statements.update(s.id, { periodStart: start, periodEnd: end })
      setOpen(false)
      onSaved()
    } catch (err) {
      setError(errorText(err, 'We could not save the period.'))
    }
  }

  const source =
    s.validation.periodSource === 'statement'
      ? 'read from the statement'
      : s.validation.periodSource === 'user'
        ? 'entered by you'
        : 'worked out from the transaction dates'

  return (
    <section className="card period">
      {open ? (
        <form className="period__form" onSubmit={save} noValidate>
          <TextField label="From" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField label="To" type="date" value={end} onChange={(e) => setEnd(e.target.value)} error={error ?? undefined} />
          <div className="row-editor__actions">
            <button type="button" className="button button--ghost button--small" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="button button--small">
              Save period
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            Statement period: <strong>{formatPeriod(s.periodStart, s.periodEnd)}</strong>{' '}
            <span className="muted">({source})</span>
          </p>
          <button type="button" className="button button--ghost button--small" onClick={() => setOpen(true)}>
            Change
          </button>
        </>
      )}
    </section>
  )
}

function SavedSection({ rows, categoryName }: { rows: SavedRow[]; categoryName: Map<string, string> }) {
  const moneyIn = rows.filter((r) => r.direction === 'inflow').reduce((s, r) => s + r.amountMinor, 0)
  const moneyOut = rows.filter((r) => r.direction === 'outflow').reduce((s, r) => s + r.amountMinor, 0)
  return (
    <section className="card">
      <div className="statements__toolbar">
        <h2>Saved transactions ({rows.length})</h2>
        <p className="muted">
          In <strong className="positive">{money(moneyIn)}</strong> · Out <strong className="negative">{money(moneyOut)}</strong>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No transactions were saved from this statement.</p>
      ) : (
        <ul className="review__rows">
          {rows.map((r) => (
            <li key={r.id} className="review-row">
              <div className="review-row__main">
                <div className="review-row__text">
                  <strong>{r.description}</strong>
                  <small className="muted">
                    {formatDate(r.date)} · {r.categoryId ? (categoryName.get(r.categoryId) ?? 'Category') : 'No category'} ·{' '}
                    {TYPE_LABELS[r.transactionType]}
                  </small>
                </div>
                <strong className={`review-row__amount ${r.direction === 'inflow' ? 'positive' : ''}`}>
                  {signedMoney(r.amountMinor, r.direction)}
                </strong>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
