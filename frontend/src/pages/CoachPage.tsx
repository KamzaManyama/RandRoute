import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useProfile } from '../auth/profileContext'
import { ApiError } from '../lib/api'
import { useApi, type CoachResult } from '../lib/useApi'
import { currentMonth, isMonth, monthLabel } from '../lib/format'
import { MonthPicker, PageHeader } from '../components/ui'
import { FormAlert } from '../components/forms'
import { AiBadge, AiConsentPanel, AiUnavailableNote, AiVerificationNote, SharedDataDetails } from '../components/ai'
import { HealthBadge } from '../components/health'

type Preview = { month: string; input: Record<string, unknown> | null; aiAvailable: boolean; error: string | null }
type Run =
  | { phase: 'idle' }
  | { phase: 'consent' }
  | { phase: 'running' }
  | { phase: 'done'; result: CoachResult }
  | { phase: 'error'; message: string }

const STEPS = [
  'RandRoute calculated your totals',
  'Sharing the summary only — no descriptions or account details',
  'AI is writing your coaching',
  'Checking every figure against your totals',
]

/**
 * AI coach. Shows the exact summary that would be shared before anything is
 * sent; AI only runs when the person presses the button.
 */
export function CoachPage() {
  const api = useApi()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const month = isMonth(params.get('month')) ? params.get('month')! : currentMonth()
  const autoStart = Boolean((location.state as { start?: boolean } | null)?.start)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [run, setRun] = useState<Run>({ phase: 'idle' })
  const started = useRef(false)

  useEffect(() => {
    let cancelled = false
    api.insights
      .coachPreview(month)
      .then((r) => !cancelled && setPreview({ month, input: r.input, aiAvailable: r.ai.available, error: null }))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setPreview({ month, input: null, aiAvailable: false, error: err instanceof ApiError ? err.message : 'We could not load your figures.' }),
      )
    return () => {
      cancelled = true
    }
  }, [api, month])

  const start = useCallback(
    async (justConsented = false) => {
      if (!justConsented && profile?.ai.consent !== 'granted') {
        setRun({ phase: 'consent' })
        return
      }
      setRun({ phase: 'running' })
      try {
        setRun({ phase: 'done', result: await api.insights.coach(month) })
      } catch (err) {
        if (err instanceof ApiError && err.code === 'consent_required') {
          setRun({ phase: 'consent' })
          return
        }
        setRun({ phase: 'error', message: err instanceof ApiError ? err.message : 'The AI coach is unavailable right now.' })
      }
    },
    [api, month, profile?.ai.consent],
  )

  // Arriving from the Insights button counts as pressing "Coach me".
  useEffect(() => {
    if (autoStart && !started.current && preview?.month === month && preview.aiAvailable && preview.input?.coverage !== 'none') {
      started.current = true
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
      void start()
    }
  }, [autoStart, preview, month, navigate, location.pathname, location.search, start])

  const changeMonth = (m: string) => {
    setRun({ phase: 'idle' })
    navigate(`/coach?month=${m}`)
  }

  const loading = !preview || preview.month !== month
  const input = loading ? null : preview.input
  const noData = input?.coverage === 'none'
  const risk = input?.risk as { level?: string } | undefined

  return (
    <div className="page">
      <PageHeader
        eyebrow="AI coach"
        title={`Your ${monthLabel(month)}, explained`}
        actions={<MonthPicker month={month} onChange={changeMonth} max={currentMonth()} />}
      />

      <section className="card stack coach-intro">
        <p>
          RandRoute works out every number from your imported statements. The coach turns those numbers into plain-language
          guidance: what went well, what to watch, and what to do next.
        </p>
        {input && !noData && (
          <div className="coach-figures" aria-label="Figures the coach will use">
            <span>
              Money in <strong>{String(input.income)}</strong>
            </span>
            <span>
              Money out <strong>{String(input.spending)}</strong>
            </span>
            <span>
              Savings rate <strong>{input.savingsRatePercent === null ? '—' : `${String(input.savingsRatePercent)}%`}</strong>
            </span>
            {risk?.level && <HealthBadge level={risk.level as never} />}
          </div>
        )}
        {input?.coverage === 'partial_month' && (
          <p className="preview-banner">Your statements only cover part of {monthLabel(month)}, so the coach will treat it as incomplete.</p>
        )}
      </section>

      {!loading && preview.error && <FormAlert>{preview.error}</FormAlert>}
      {loading && <p className="muted" role="status">Loading your figures…</p>}

      {!loading && noData && (
        <section className="card stack">
          <h2 className="section-title">Nothing to coach on yet</h2>
          <p className="muted">There are no imported statements for {monthLabel(month)}.</p>
          <Link to="/statements/upload" className="button">
            Upload a statement
          </Link>
        </section>
      )}

      {!loading && !noData && input && !preview.aiAvailable && <AiUnavailableNote />}

      {!loading && !noData && input && preview.aiAvailable && (
        <>
          {run.phase === 'consent' && <AiConsentPanel onDone={(granted) => (granted ? void start(true) : setRun({ phase: 'idle' }))} />}

          {(run.phase === 'idle' || run.phase === 'error') && (
            <section className="card stack">
              {run.phase === 'error' && <FormAlert>{run.message}</FormAlert>}
              <SharedDataDetails data={input} />
              <div className="form-actions">
                <button type="button" className="button" onClick={() => void start()}>
                  {run.phase === 'error' ? 'Try again' : `Coach me on ${monthLabel(month)}`}
                </button>
              </div>
            </section>
          )}

          {run.phase === 'running' && (
            <section className="card stack" aria-live="polite">
              <h2 className="section-title">Working on it…</h2>
              <ol className="steps">
                {STEPS.map((label, i) => (
                  <li key={label} className={`steps__item ${i < 2 ? 'steps__item--done' : 'steps__item--active'}`}>
                    <span className="steps__icon" aria-hidden>
                      {i < 2 ? '✓' : ''}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {run.phase === 'done' && <CoachResultView result={run.result} onAgain={() => void start()} />}
        </>
      )}
    </div>
  )
}

function CoachResultView({ result, onAgain }: { result: CoachResult; onAgain: () => void }) {
  const { coach } = result
  return (
    <div className="stack coach-result">
      <section className="card stack" aria-label="Summary">
        <div className="card__header card__header--flush">
          <h2 className="section-title">This month in brief</h2>
          <AiBadge />
        </div>
        <p className="coach-summary">{coach.summary}</p>
      </section>

      <div className="coach-grid">
        <CoachList title="What went well" tone="good" items={coach.positives} />
        <CoachList title="What to watch" tone="warning" items={coach.concerns} />
        <CoachList title="Next steps" tone="action" items={coach.actions} ordered />
      </div>

      <section className="card coach-motivation">
        <p>{coach.motivation}</p>
      </section>

      <AiVerificationNote verification={result.verification} generatedAt={result.generatedAt} />
      <SharedDataDetails data={result.basedOn} title="What was shared to write this" />
      <div className="form-actions">
        <Link to="/budget" className="button button--ghost">
          Review my budget
        </Link>
        <button type="button" className="button button--ghost" onClick={onAgain}>
          Ask again
        </button>
      </div>
    </div>
  )
}

function CoachList({ title, tone, items, ordered = false }: { title: string; tone: 'good' | 'warning' | 'action'; items: string[]; ordered?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <section className={`card stack coach-list coach-list--${tone}`} aria-label={title}>
      <h3 className="section-title">{title}</h3>
      <List className="ai-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </section>
  )
}
