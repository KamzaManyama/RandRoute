import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useProfile } from '../auth/profileContext'
import { ApiError, type StreamEvent } from '../lib/api'
import { currentMonth, isMonth, monthLabel } from '../lib/format'
import { PageHeader } from '../components/ui'
import { FormAlert } from '../components/forms'
import { AiConsentPanel, AiText, AiUnavailableNote } from '../components/ai'

type Step = { id: string; label: string; state: 'active' | 'done' }
type Run = {
  phase: 'idle' | 'consent' | 'running' | 'done' | 'error'
  steps: Step[]
  thought: string
  text: string
  error: string | null
}

const EMPTY: Run = { phase: 'idle', steps: [], thought: '', text: '', error: null }

/** The model's thought summaries: "**Title**" lines become bold headings. */
function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return (
    <div className="thinking__text">
      {lines.map((line, i) => {
        const title = /^\*\*(.+)\*\*$/.exec(line)
        return title ? (
          <p key={i} className="thinking__title">
            {title[1]}
          </p>
        ) : (
          <p key={i}>{line.replace(/\*\*(.+?)\*\*/g, '$1')}</p>
        )
      })}
      {streaming && <span className="thinking__cursor" aria-hidden />}
    </div>
  )
}

/**
 * Explain my spending — streams each step, the AI's thinking, then the answer.
 * Only starts from an explicit click (the Insights button, or "Explain" here).
 */
export function ExplainPage() {
  const { authStream } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const month = isMonth(params.get('month')) ? params.get('month')! : currentMonth()
  const autoStart = Boolean((location.state as { start?: boolean } | null)?.start)

  const [run, setRun] = useState<Run>(EMPTY)
  const [thinkingOpen, setThinkingOpen] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const started = useRef(false)

  const start = useCallback(
    async (justConsented = false) => {
      if (!justConsented && profile?.ai.consent !== 'granted') {
        setRun({ ...EMPTY, phase: 'consent' })
        return
      }
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setThinkingOpen(true)
      setRun({ ...EMPTY, phase: 'running' })

      const onEvent = ({ event, data }: StreamEvent) => {
        const d = (data ?? {}) as Record<string, string>
        setRun((r) => {
          switch (event) {
            case 'step': {
              const step = { id: d.id!, label: d.label!, state: d.state as Step['state'] }
              const exists = r.steps.some((s) => s.id === step.id)
              return { ...r, steps: exists ? r.steps.map((s) => (s.id === step.id ? step : s)) : [...r.steps, step] }
            }
            case 'thought':
              return { ...r, thought: r.thought + (d.text ?? '') }
            case 'text':
              return { ...r, text: r.text + (d.text ?? '') }
            case 'done':
              return { ...r, phase: 'done' }
            case 'error':
              return { ...r, phase: 'error', error: d.message ?? 'The AI service is unavailable right now.' }
            default:
              return r
          }
        })
        if (event === 'text') setThinkingOpen(false) // answer started: tuck the thinking away
      }

      try {
        await authStream('/api/insights/explain/stream', { month }, onEvent, controller.signal)
        setRun((r) => (r.phase === 'running' ? { ...r, phase: r.text ? 'done' : 'error', error: r.text ? null : 'The explanation stopped early. Please try again.' } : r))
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof ApiError && err.code === 'consent_required') {
          setRun({ ...EMPTY, phase: 'consent' })
          return
        }
        setRun((r) => ({ ...r, phase: 'error', error: err instanceof ApiError ? err.message : 'The AI service is unavailable right now.' }))
      }
    },
    [authStream, month, profile?.ai.consent],
  )

  // Opened from the Insights button: start once, and drop the flag so a refresh doesn't re-run it.
  useEffect(() => {
    if (!autoStart || started.current || !profile?.ai.available) return
    started.current = true
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    void start()
  }, [autoStart, profile?.ai.available, start, navigate, location.pathname, location.search])

  useEffect(() => () => abortRef.current?.abort(), [])

  const running = run.phase === 'running'
  const answerStreaming = running && run.text.length > 0

  return (
    <div className="page explain">
      <PageHeader
        eyebrow={
          <>
            <Link to={`/insights?month=${month}`}>Insights</Link> / Explain my spending
          </>
        }
        title={`Your spending in ${monthLabel(month)}`}
        description="A plain-language explanation of your month, with ideas to save — written by AI from figures RandRoute calculated."
        actions={
          profile?.ai.available && (
            <button type="button" className="button" onClick={() => start()} disabled={running}>
              {running ? 'Explaining…' : run.phase === 'idle' || run.phase === 'consent' ? 'Explain my spending' : 'Explain again'}
            </button>
          )
        }
      />

      {!profile?.ai.available && <AiUnavailableNote />}

      {run.phase === 'idle' && profile?.ai.available && (
        <section className="card stack">
          <p>
            Press <strong>Explain my spending</strong> to see where your money went in {monthLabel(month)}, what changed,
            and practical ways to save.
          </p>
          <p className="muted small">Only your category totals for this month are shared — never descriptions, account numbers or personal details.</p>
        </section>
      )}

      {run.phase === 'consent' && <AiConsentPanel onDone={(granted) => (granted ? void start(true) : setRun(EMPTY))} />}

      {run.steps.length > 0 && (
        <section className="card" aria-label="Progress">
          <ol className="steps">
            {run.steps.map((s) => (
              <li key={s.id} className={`steps__item steps__item--${s.state}`}>
                <span className="steps__icon" aria-hidden>
                  {s.state === 'done' ? '✓' : ''}
                </span>
                <span>{s.label}</span>
                <span className="visually-hidden">{s.state === 'done' ? '(done)' : '(in progress)'}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {run.thought && (
        <details className="card thinking" open={thinkingOpen} onToggle={(e) => setThinkingOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="thinking__summary">
            <span className="thinking__badge">AI thinking</span>
            <span className="muted small">
              {running && !run.text ? 'Working through your figures…' : 'How the AI worked it out — tap to ' + (thinkingOpen ? 'hide' : 'show')}
            </span>
          </summary>
          <Thinking text={run.thought} streaming={running && !run.text} />
        </details>
      )}

      {run.text && (
        <section className="card stack ai-answer" aria-label="Explanation" aria-busy={answerStreaming}>
          <div className="card__header card__header--flush">
            <h2 className="section-title">Your explanation</h2>
            <span className="status-badge status--muted">Written by AI</span>
          </div>
          <AiText text={run.text} />
          {answerStreaming && <span className="thinking__cursor" aria-hidden />}
          {run.phase === 'done' && (
            <p className="muted small">
              The amounts come from RandRoute&apos;s own calculations. Only category totals were shared with the AI. This is
              general guidance, not financial advice.
            </p>
          )}
        </section>
      )}

      {run.phase === 'error' && (
        <FormAlert>
          <span>{run.error}</span>
          <span>
            <button type="button" className="link-button" onClick={() => start()}>
              Try again
            </button>
          </span>
        </FormAlert>
      )}

      {run.phase === 'done' && (
        <div className="form-actions">
          <Link to={`/insights?month=${month}`} className="button button--ghost">
            Back to insights
          </Link>
          <Link to={`/budget?month=${month}`} className="button">
            Set limits in Budget
          </Link>
        </div>
      )}
    </div>
  )
}
