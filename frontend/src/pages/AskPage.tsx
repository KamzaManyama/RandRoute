import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi, type AiAnswer } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { currentMonth, isMonth, monthLabel, shiftMonth } from '../lib/format'
import { PageHeader } from '../components/ui'
import { FormAlert } from '../components/forms'
import { AiAnswerCard, AiConsentPanel, AiUnavailableNote } from '../components/ai'
import { useProfile } from '../auth/profileContext'

const EXAMPLES = [
  'Why did my transport spending change?',
  'How much did I spend on subscriptions this month?',
  'What would happen if I spent less on takeaways?',
  'Which categories went over my budget?',
]

/** Screen 15 — Ask RandRoute. Answers use only figures RandRoute calculated. */
export function AskPage() {
  const api = useApi()
  const { profile } = useProfile()
  const [params] = useSearchParams()
  const [month, setMonth] = useState(isMonth(params.get('month')) ? params.get('month')! : currentMonth())
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<{ month: string; answer: AiAnswer }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsConsent, setNeedsConsent] = useState(false)

  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(currentMonth(), -i))

  async function ask(event?: FormEvent, justConsented = false) {
    event?.preventDefault()
    const q = question.trim()
    if (q.length < 3) {
      setError('Type a question first.')
      return
    }
    if (!justConsented && profile?.ai.consent !== 'granted') {
      setNeedsConsent(true)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const answer = await api.insights.ask(month, q)
      setAnswers((a) => [{ month, answer }, ...a])
      setQuestion('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not get an answer right now.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <>
            <Link to={`/insights?month=${month}`}>Insights</Link> / Ask
          </>
        }
        title="Ask RandRoute"
        description="Questions about your imported spending, answered in plain language."
      />

      {!profile?.ai.available ? (
        <section className="card stack">
          <AiUnavailableNote />
          <p className="muted">You can still explore everything in Spending, Budget and Insights.</p>
        </section>
      ) : (
        <>
          <form className="card stack" onSubmit={ask} noValidate>
            <div className="field">
              <label htmlFor="ask-question" className="field__label">
                Your question
              </label>
              <textarea
                id="ask-question"
                className="field__input"
                maxLength={300}
                placeholder="e.g. Why did my spending go up this month?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <p className="field__hint">{300 - question.length} characters left</p>
            </div>
            <div className="toolbar">
              <label htmlFor="ask-month" className="field__label">
                About
              </label>
              <select id="ask-month" className="field__input field__input--inline" value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
              <span className="toolbar__grow" />
              <button type="submit" className="button" disabled={loading}>
                {loading ? 'Thinking…' : 'Ask'}
              </button>
            </div>
            <div className="chips" aria-label="Example questions">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" className="filter-chip" onClick={() => setQuestion(q)}>
                  {q}
                </button>
              ))}
            </div>
            <p className="muted small">
              Only category totals for the month you pick are shared — never descriptions, account numbers or your name.
            </p>
          </form>

          {needsConsent && (
            <AiConsentPanel
              onDone={(granted) => {
                setNeedsConsent(false)
                if (granted) void ask(undefined, true)
              }}
            />
          )}
          {error && <FormAlert>{error}</FormAlert>}

          {answers.length > 0 && (
            <div className="stack">
              <div className="card__header card__header--flush">
                <h2 className="section-title">Answers</h2>
                <button type="button" className="link-button small" onClick={() => setAnswers([])}>
                  Clear conversation
                </button>
              </div>
              {answers.map((a) => (
                <AiAnswerCard key={a.answer.generatedAt} answer={a.answer} title={`Answer · ${monthLabel(a.month)}`} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
