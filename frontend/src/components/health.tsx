import type { Health, HealthLevel } from '../lib/useApi'

const LEVELS: Record<HealthLevel, { label: string; className: string; blurb: string }> = {
  healthy: { label: 'On track', className: 'health--good', blurb: 'Your money in comfortably covers your money out.' },
  watch: { label: 'Worth watching', className: 'health--watch', blurb: 'A few things need attention before they grow.' },
  at_risk: { label: 'At risk', className: 'health--risk', blurb: 'Spending or debt is putting pressure on your income.' },
  not_enough_data: { label: 'Not enough data', className: 'health--muted', blurb: 'We need more information to judge this month.' },
}

export function HealthBadge({ level }: { level: HealthLevel }) {
  const info = LEVELS[level] ?? LEVELS.not_enough_data
  return <span className={`health-badge ${info.className}`}>{info.label}</span>
}

const TONE_ICON: Record<string, string> = { good: '✓', warning: '!', risk: '!', info: 'i' }

/**
 * Money health: a level worked out by fixed app rules (not AI), with every
 * reason it was based on.
 */
export function HealthCard({ health }: { health: Health }) {
  const info = LEVELS[health.level] ?? LEVELS.not_enough_data
  return (
    <section className="card stack health-card" aria-labelledby="health-title">
      <div className="card__header card__header--flush">
        <h2 id="health-title" className="section-title">
          Money health
        </h2>
        <HealthBadge level={health.level} />
      </div>
      <p className="muted">
        {info.blurb}
        {health.provisional && health.level !== 'not_enough_data' && ' Provisional: this month isn’t fully covered yet.'}
      </p>
      <ul className="health-reasons">
        {health.reasons.map((r) => (
          <li key={r.code} className={`health-reason health-reason--${r.tone}`}>
            <span className="health-reason__icon" aria-hidden>
              {TONE_ICON[r.tone]}
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Calculated by RandRoute from your imported statements using fixed rules — not a credit score or financial advice.</p>
    </section>
  )
}
