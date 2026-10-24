import './InsightsPage.css'

type InsightItem = {
  label: string
  value: string
  tone: 'positive' | 'negative' | 'neutral'
}

const summary: InsightItem[] = [
  { label: 'Spending change', value: '+6.2%', tone: 'negative' },
  { label: 'Top category', value: 'Housing', tone: 'neutral' },
  { label: 'Budget status', value: '3 categories over', tone: 'negative' },
  { label: 'Coverage', value: 'Partial month', tone: 'neutral' },
]

const trends = [
  { name: 'Groceries', change: '+12%', detail: 'Higher weekly food costs this month', tone: 'negative' },
  { name: 'Transport', change: '+8%', detail: 'More fuel and commute days', tone: 'negative' },
  { name: 'Dining', change: '-5%', detail: 'Fewer takeaways than last month', tone: 'positive' },
  { name: 'Health', change: '+2%', detail: 'Routine costs remained steady', tone: 'neutral' },
]

export function InsightsPage() {
  return (
    <div className="insights">
      <header className="insights__header">
        <div>
          <p className="muted">Trend overview</p>
          <h1>Insights</h1>
        </div>
        <button type="button" className="button">
          Explain this trend
        </button>
      </header>

      <p className="preview-banner" role="note">
        Preview with sample numbers — this page isn't connected to your statements yet.
      </p>

      <section className="card">
        <div className="insights__summary">
          {summary.map((item) => (
            <div key={item.label} className="insights__stat">
              <span>{item.label}</span>
              <strong className={item.tone === 'negative' ? 'negative' : item.tone === 'positive' ? 'positive' : ''}>
                {item.value}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <div className="insights__content">
        <section className="card">
          <h2 className="section-title">Spending changes</h2>
          <ul className="insights__list">
            {trends.map((trend) => (
              <li key={trend.name}>
                <div>
                  <strong>{trend.name}</strong>
                  <small>{trend.detail}</small>
                </div>
                <span className={trend.tone === 'negative' ? 'negative' : trend.tone === 'positive' ? 'positive' : 'muted'}>
                  {trend.change}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card insights__panel">
          <h2 className="section-title">What this means</h2>
          <p className="muted">
            Your spending is up mainly because food, travel, and routine household costs rose over the last month.
            A few categories are over budget, but this view reflects partial statement coverage and should be treated as a
            working summary.
          </p>
          <div className="insights__note">
            <strong>AI note</strong>
            <p>
              RandRoute does not call Gemini until you explicitly ask for an explanation or budget suggestion.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
