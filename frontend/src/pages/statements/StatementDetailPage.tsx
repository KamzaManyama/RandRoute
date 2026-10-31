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
import { FilterSelect, PageHeader, Stat, Stats } from '../../components/ui'
import { Pagination } from '../../components/Pagination'
import { PAGE_SIZE, usePaged } from '../../lib/paging'
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
            <Link to="/statements" className="text-link">
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
      <PageHeader
        eyebrow={
          <>
            <Link to="/statements">Statements</Link> / {statement.bankName}
          </>
        }
        title={`${statement.bankName}${statement.nickname ? ` · ${statement.nickname}` : ""}`}
        description={formatPeriod(statement.periodStart, statement.periodEnd)}
        actions={<span className={`status-badge ${status.tone}`}>{status.label}</span>}
      />

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

      {statement.status !== 'cancelled' && <BankEditor detail={detail} onSaved={load} />}
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

/** Shows the bank and lets the user correct it (e.g. if it was detected wrongly). */
function BankEditor({ detail, onSaved }: { detail: StatementDetail; onSaved: () => void }) {
  const api = useApi()
  const s = detail.statement
  const [open, setOpen] = useState(false)
  const [formats, setFormats] = useState<{ key: string; name: string }[]>([])
  const [bank, setBank] = useState(s.bankFormat)
  const [nickname, setNickname] = useState(s.nickname ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function openEditor() {
    setOpen(true)
    setBank(s.bankFormat)
    setNickname(s.nickname ?? '')
    if (formats.length === 0) setFormats(await api.statements.formats().catch(() => []))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.statements.update(s.id, { bankFormat: bank, nickname: nickname.trim() || null })
      setOpen(false)
      onSaved()
    } catch (err) {
      setError(errorText(err, 'We could not update the bank.'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <section className="card period">
        <p>
          Bank: <strong>{s.bankName}</strong>
          {s.nickname ? <> · {s.nickname}</> : null} <span className="muted small">— wrong bank? You can change it.</span>
        </p>
        <button type="button" className="button button--ghost button--small" onClick={openEditor}>
          Change bank
        </button>
      </section>
    )
  }
  return (
    <form className="card stack" onSubmit={save} noValidate>
      <h2 className="section-title">Which bank is this statement from?</h2>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="bank-format" className="field__label">
            Bank
          </label>
          <select id="bank-format" className="field__input" value={bank} onChange={(e) => setBank(e.target.value)}>
            {formats.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <TextField label="Nickname (optional)" value={nickname} maxLength={60} onChange={(e) => setNickname(e.target.value)} />
      </div>
      <p className="muted small">This only changes the label. Your transactions and amounts stay exactly as imported.</p>
      <div className="form-actions">
        <button type="button" className="button button--ghost button--small" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="button button--small" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
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
  if (v.columnTotalsCheck && v.columnTotalsCheck !== 'unavailable') {
    checks.push({
      label: "Statement's own totals",
      value: v.columnTotalsCheck === 'passed' ? 'Match our rows' : "Don't match",
      tone: v.columnTotalsCheck === 'passed' ? 'status--good' : 'status--warn',
    })
  }
  if (v.rowsSkipped > 0) {
    checks.push({ label: 'Lines left out', value: `${v.rowsSkipped} unreadable`, tone: 'status--warn' })
  }
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
        {v.layoutDetected ? 'Read using the statement’s column headings. ' : 'No column headings found, so amounts were read by position. '}
        {v.newestFirst ? 'Rows were listed newest-first and have been put in date order. ' : ''}
        {v.feeRows > 0 ? `${v.feeRows} fee(s) from the bank’s fee column are shown as their own rows. ` : ''}
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
  const unchecked = rows.filter((r) => willImport(r) && r.reviewStatus === 'needs_review')
  const hasWarnings = detail.statement.warnings.length > 0
  const [acknowledged, setAcknowledged] = useState(false)
  const [acceptNote, setAcceptNote] = useState<string | null>(null)
  const isMismatch = (r: ReviewRow) => r.flags.some((f) => f.code === 'balance_mismatch')
  const duplicates = rows.filter((r) => r.duplicateOf)
  const unresolved = rows.filter((r) => r.duplicateDecision === 'unresolved' && r.include)
  const excluded = rows.filter((r) => !willImport(r))
  const included = rows.filter(willImport)
  const moneyIn = included.filter((r) => r.direction === 'inflow').reduce((s, r) => s + r.amountMinor, 0)
  const moneyOut = included.filter((r) => r.direction === 'outflow').reduce((s, r) => s + r.amountMinor, 0)

  const tab: Tab = props.tab ?? (attention.length > 0 ? 'attention' : 'all')
  const shown =
    tab === 'attention' ? attention : tab === 'duplicates' ? duplicates : tab === 'excluded' ? excluded : rows
  const paged = usePaged(shown, PAGE_SIZE, tab)

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
      const { accepted } = await api.statements.acceptAll(id)
      setRows(rows.map((r) => (r.reviewStatus === 'needs_review' && !r.duplicateOf && !isMismatch(r) ? { ...r, reviewStatus: 'user_confirmed' } : r)))
      const left = rows.filter((r) => r.reviewStatus === 'needs_review' && (r.duplicateOf || isMismatch(r))).length
      setAcceptNote(
        `Marked ${accepted} row${accepted === 1 ? '' : 's'} as checked.` +
          (left > 0 ? ` ${left} still need a look one by one (possible duplicates or balance mismatches).` : ''),
      )
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
      const { saved } = await api.statements.confirm(id, acknowledged)
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

      <Stats label="Import summary">
        <Stat label="Will be imported" value={included.length} />
        <Stat label="Need a check" value={attention.length} tone={attention.length > 0 ? "warn" : undefined} />
        <Stat label="Money in" value={money(moneyIn)} tone="positive" />
        <Stat label="Money out" value={money(moneyOut)} />
      </Stats>

      <section className="card">
        <div className="card__header">
          <h2 className="section-title">Transactions</h2>
          <FilterSelect
            label="Show"
            value={tab}
            onChange={props.setTab}
            options={[
              { value: "attention", label: `Needs a check (${attention.length})` },
              { value: "duplicates", label: `Possible duplicates (${duplicates.length})` },
              { value: "all", label: `All (${rows.length})` },
              { value: "excluded", label: `Excluded (${excluded.length})` },
            ]}
          />
        </div>

        {shown.length === 0 ? (
          <p className="muted">
            {tab === 'attention' ? 'Nothing needs checking. 🎉' : tab === 'duplicates' ? 'No possible duplicates.' : 'No rows here.'}
          </p>
        ) : (
          <ul className="review__rows">
            {paged.pageItems.map((row) => (
              <ReviewRowItem key={row.id} row={row} categories={categories} onUpdate={updateRow} />
            ))}
          </ul>
        )}
        <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onChange={paged.setPage} label="Transaction pages" />
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
              : unchecked.length > 0
                ? `Check ${unchecked.length} row${unchecked.length === 1 ? '' : 's'} marked for review first.`
                : 'Nothing is saved until you confirm.'}
          </p>
          {acceptNote && (
            <p className="small" role="status">
              {acceptNote}
            </p>
          )}
          {hasWarnings && (
            <label className="checkbox review__ack">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              <span>I&apos;ve read the warnings above and checked the rows against my statement.</span>
            </label>
          )}
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
              {attention.some((r) => r.reviewStatus === 'needs_review' && !r.duplicateOf && !isMismatch(r)) && (
                <button type="button" className="button button--ghost" onClick={acceptAll} disabled={busy !== null}>
                  Mark all as checked
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={confirm}
                disabled={busy !== null || unresolved.length > 0 || unchecked.length > 0 || included.length === 0 || (hasWarnings && !acknowledged)}
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
  const lowCategory = (row.categoryConfidence ?? 1) < 0.6
  const confidence = Math.min(row.extractionConfidence ?? 1, row.categoryConfidence ?? 1)
  const confidenceLabel = confidence >= 0.9 ? 'High confidence' : confidence >= 0.6 ? 'Medium confidence' : 'Low confidence'
  const visibleFlags = row.flags.filter((f) => f.code !== 'fee_split' || !unchecked)

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
          <small className="muted">
            {formatDate(row.date)} · {row.channelLabel}
            {' · '}
            <span className={`confidence confidence--${confidence >= 0.9 ? 'high' : confidence >= 0.6 ? 'medium' : 'low'}`}>{confidenceLabel}</span>
          </small>
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

      {visibleFlags.length > 0 && (
        <ul className="row-flags" aria-label="Checks for this row">
          {visibleFlags.map((f) => (
            <li key={f.code} className={`row-flag${f.blocking ? ' row-flag--blocking' : ''}`}>
              {f.label}
            </li>
          ))}
        </ul>
      )}

      {unchecked && (
        <p className="review-row__why">
          {row.flags.length === 0 && lowCategory && 'We weren’t sure about the category or type. '}
          {row.flags.length === 0 && !lowCategory && !row.duplicateOf && 'Please check this row against your statement. '}
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
        <div className="chips" role="group" aria-label="Money in or out">
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
  const paged = usePaged(rows, PAGE_SIZE)
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="section-title">Saved transactions ({rows.length})</h2>
        <p className="muted">
          In <strong className="positive">{money(moneyIn)}</strong> · Out <strong className="negative">{money(moneyOut)}</strong>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No transactions were saved from this statement.</p>
      ) : (
        <ul className="review__rows">
          {paged.pageItems.map((r) => (
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
      <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onChange={paged.setPage} label="Saved transaction pages" />
    </section>
  )
}
