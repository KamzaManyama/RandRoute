import { PageHeader, Stat, Stats } from '../components/ui'

// Sample content until Insights is connected (Roadmap phases 5–6).
const trends = [
  { name: 'Groceries', change: '+12%', detail: 'Higher weekly food costs this month', tone: 'negative' },
  { name: 'Transport & fuel', change: '+8%', detail: 'More fuel and commute days', tone: 'negative' },
  { name: 'Eating out & takeaways', change: '−5%', detail: 'Fewer takeaways than last month', tone: 'positive' },
  { name: 'Medical & pharmacy', change: '+2%', detail: 'Routine costs stayed steady', tone: '' },
]

/** Screen 14 — Monthly insights (preview). Opening this page never calls AI. */
export function InsightsPage() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Trend overview"
        title="Insights"
        actions={
          <button type="button" className="button" disabled>
            Explain this trend
          </button>
        }
      />

      <p className="preview-banner" role="note">
        Preview with sample numbers — this page isn&apos;t connected to your statements yet.
      </p>

      <Stats label="Insight summary">
        <Stat label="Spending change" value="+6.2%" tone="negative" />
        <Stat label="Top category" value="Rent & bond" />
        <Stat label="Budget status" value="2 over" tone="negative" />
        <Stat label="Coverage" value="Partial month" tone="warn" />
      </Stats>

      <div className="columns">
        <section className="card">
          <h2 className="section-title">Spending changes</h2>
          <ul className="list">
            {trends.map((t) => (
              <li key={t.name} className="list-row">
                <span className="list-row__main">
                  <span className="list-row__title">{t.name}</span>
                  <span className="list-row__meta">{t.detail}</span>
                </span>
                <span className={`list-row__value ${t.tone}`}>{t.change}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card stack">
          <h2 className="section-title">What this means</h2>
          <p className="muted">
            Spending rose mainly because food and transport cost more. This view reflects partial statement coverage, so
            treat it as a working summary.
          </p>
          <p className="preview-banner">
            <strong>About AI:</strong> RandRoute only asks Gemini for an explanation when you press &ldquo;Explain this
            trend&rdquo; — never just by opening this page.
          </p>
        </section>
      </div>
    </div>
  )
}
