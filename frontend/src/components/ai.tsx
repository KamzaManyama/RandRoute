import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../auth/profileContext'
import { useApi, type AiAnswer } from '../lib/useApi'
import { ApiError } from '../lib/api'
import { FormAlert } from './forms'

/** What we tell people before they switch AI on. Keep in step with AI_POLICY_VERSION on the backend. */
export function AiPolicyText() {
  return (
    <ul className="ai-policy">
      <li>RandRoute calculates every number itself. AI only explains those numbers in plain language.</li>
      <li>
        When you press an AI button, we send Google&apos;s Gemini service a short summary: month totals and category
        totals. <strong>Never</strong> your PDFs, transaction descriptions, account numbers, name or email.
      </li>
      <li>AI only runs when you press a button — never just by opening a page.</li>
      <li>Answers are general guidance, not financial advice, and can be wrong. Check them against your figures.</li>
      <li>You can switch this off at any time in Profile &amp; privacy.</li>
    </ul>
  )
}

/** Asks for consent in place, the first time someone uses an AI feature. */
export function AiConsentPanel({ onDone }: { onDone?: (granted: boolean) => void }) {
  const api = useApi()
  const { setProfile } = useProfile()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(granted: boolean) {
    setBusy(true)
    setError(null)
    try {
      setProfile(await api.profile.setAiConsent(granted))
      onDone?.(granted)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save your choice.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack ai-consent" aria-labelledby="ai-consent-title">
      <h2 id="ai-consent-title" className="section-title">
        Use AI explanations?
      </h2>
      <AiPolicyText />
      {error && <FormAlert>{error}</FormAlert>}
      <div className="form-actions">
        <button type="button" className="button button--ghost" onClick={() => choose(false)} disabled={busy}>
          No thanks
        </button>
        <button type="button" className="button" onClick={() => choose(true)} disabled={busy}>
          I agree — turn on AI
        </button>
      </div>
    </section>
  )
}

/** Renders AI text simply: paragraphs, and "- " / "* " lines as a list. No HTML is ever injected. */
function AiText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((item, i) => <li key={i}>{item}</li>)}</ul>)
    list = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/\*\*(.+?)\*\*/g, '$1')
    if (/^[-*•]\s+/.test(line)) list.push(line.replace(/^[-*•]\s+/, ''))
    else {
      flush()
      if (line) blocks.push(<p key={`p${blocks.length}`}>{line}</p>)
    }
  }
  flush()
  return <div className="ai-text">{blocks}</div>
}

/** An AI answer with clear labelling and exactly what was shared to produce it. */
export function AiAnswerCard({ answer, title = 'AI explanation' }: { answer: AiAnswer; title?: string }) {
  return (
    <section className="card stack ai-answer" aria-label={title}>
      <div className="card__header card__header--flush">
        <h2 className="section-title">{title}</h2>
        <span className="status-badge status--muted">Written by AI</span>
      </div>
      {answer.question && <p className="ai-answer__question">“{answer.question}”</p>}
      <AiText text={answer.text} />
      <p className="muted small">
        Based only on the figures RandRoute calculated. General guidance, not financial advice — check it against your
        numbers.
      </p>
      <details className="ai-answer__shared">
        <summary>What was shared with the AI</summary>
        <pre>{JSON.stringify(answer.basedOn, null, 2)}</pre>
      </details>
    </section>
  )
}

/** Explains why an AI button isn't available. */
export function AiUnavailableNote() {
  return (
    <p className="muted small">
      AI explanations are switched off on this server. All figures still work.{' '}
      <Link to="/profile" className="text-link">
        Learn more
      </Link>
    </p>
  )
}
