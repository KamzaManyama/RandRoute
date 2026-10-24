import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi, type BankFormat } from '../../lib/useApi'
import { ApiError } from '../../lib/api'
import { FormAlert, TextField } from '../../components/forms'
import { PageHeader } from '../../components/ui'
import { ShieldIcon, StatementsIcon } from '../../components/icons'
import './statements.css'

const MAX_BYTES = 10 * 1024 * 1024

function fileProblem(file: File): string | undefined {
  const looksPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!looksPdf) return 'Choose a PDF file. Download your statement from your banking app as a PDF.'
  if (file.size > MAX_BYTES) return 'This file is bigger than 10 MB. Upload one statement at a time.'
  if (file.size === 0) return 'This file is empty.'
  return undefined
}

/** Screens 06–07 — Upload a statement, then read it. */
export function UploadStatementPage() {
  const api = useApi()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [formats, setFormats] = useState<BankFormat[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [bankFormat, setBankFormat] = useState('auto')
  const [nickname, setNickname] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    api.statements
      .formats()
      .then(setFormats)
      .catch(() => setFormats([]))
    return () => abortRef.current?.abort()
  }, [api])

  function chooseFile(next: File | undefined) {
    if (!next) return
    const problem = fileProblem(next)
    setFieldErrors((e) => ({ ...e, file: problem ?? '' }))
    setError(null)
    setFile(problem ? null : next)
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files[0])
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const errors: Record<string, string> = {}
    if (!file) errors.file = 'Choose a PDF statement.'
    if (Boolean(periodStart) !== Boolean(periodEnd)) errors.periodEnd = 'Enter both dates, or leave both empty.'
    if (periodStart && periodEnd && periodEnd < periodStart) errors.periodEnd = 'The end date must be after the start date.'
    setFieldErrors(errors)
    if (Object.keys(errors).length || !file) return

    const form = new FormData()
    form.append('file', file)
    form.append('bankFormat', bankFormat)
    if (nickname.trim()) form.append('nickname', nickname.trim())
    if (periodStart && periodEnd) {
      form.append('periodStart', periodStart)
      form.append('periodEnd', periodEnd)
    }

    const controller = new AbortController()
    abortRef.current = controller
    setProcessing(true)
    try {
      const result = await api.statements.upload(form, controller.signal)
      navigate(`/statements/${result.importId}`, { replace: true, state: { justUploaded: result } })
    } catch (err) {
      if (controller.signal.aborted) return
      if (err instanceof ApiError) {
        setFieldErrors(err.fields)
        setError(err.message)
      } else {
        setError('Something went wrong while reading your statement. Please try again.')
      }
      setProcessing(false)
    }
  }

  function cancelProcessing() {
    abortRef.current?.abort()
    setProcessing(false)
  }

  if (processing) {
    return (
      <div className="page">
        <section className="card upload-processing" role="status" aria-live="polite">
          <div className="upload-processing__spinner" aria-hidden />
          <h1>Reading your statement…</h1>
          <p className="muted">This usually takes a few seconds.</p>
          <ul className="upload-processing__steps">
            <li>Finding transactions and cleaning descriptions</li>
            <li>Checking each row against the running balance</li>
            <li>Suggesting categories and spotting possible duplicates</li>
          </ul>
          <p className="muted">Nothing is saved until you review and confirm.</p>
          <button type="button" className="button button--ghost" onClick={cancelProcessing}>
            Cancel
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <>
            <Link to="/statements">Statements</Link> / Upload
          </>
        }
        title="Upload a statement"
      />

      <form className="card upload-form" onSubmit={onSubmit} noValidate>
        {error && <FormAlert>{error}</FormAlert>}

        <label
          className={`dropzone${dragging ? ' dropzone--active' : ''}${fieldErrors.file ? ' dropzone--error' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            aria-describedby="file-help"
            onChange={(e: ChangeEvent<HTMLInputElement>) => chooseFile(e.target.files?.[0])}
          />
          <StatementsIcon width={32} height={32} />
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span className="muted">{(file.size / 1024).toFixed(0)} KB · click to choose a different file</span>
            </>
          ) : (
            <>
              <strong>Drop your statement PDF here</strong>
              <span className="muted">or click to choose a file (PDF, up to 10 MB)</span>
            </>
          )}
        </label>
        {fieldErrors.file && <p className="field__error">{fieldErrors.file}</p>}

        <div className="field">
          <label htmlFor="bank" className="field__label">
            Bank
          </label>
          <select id="bank" className="field__input" value={bankFormat} onChange={(e) => setBankFormat(e.target.value)}>
            <option value="auto">Detect automatically</option>
            {formats.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
          <p className="field__hint">
            Bank formats are in beta — we check each row against your running balance, but please review before
            importing.
          </p>
        </div>

        <TextField
          label="Nickname (optional)"
          name="nickname"
          placeholder="e.g. Cheque account"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          error={fieldErrors.nickname}
          maxLength={60}
        />

        <fieldset className="upload-form__period">
          <legend className="field__label">Statement period (optional)</legend>
          <p className="field__hint">Leave empty and we&apos;ll read it from the statement. You can change it on the next screen.</p>
          <div className="upload-form__dates">
            <TextField
              label="From"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              error={fieldErrors.periodStart}
            />
            <TextField
              label="To"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              error={fieldErrors.periodEnd}
            />
          </div>
        </fieldset>

        <p id="file-help" className="upload-form__privacy">
          <ShieldIcon />
          <span>
            Your PDF is read in memory and deleted straight away. We only keep the cleaned transactions you confirm —
            never the PDF, account numbers or card numbers.
          </span>
        </p>

        <div className="upload-form__actions">
          <Link to="/statements" className="button button--ghost">
            Cancel
          </Link>
          <button type="submit" className="button" disabled={!file}>
            Read statement
          </button>
        </div>
      </form>
    </div>
  )
}
