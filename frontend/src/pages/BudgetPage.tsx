import './BudgetPage.css'

type BudgetRow = {
  category: string
  planned: number
  spent: number
  remaining: number
  status: 'on-track' | 'warning' | 'over'
}

const rows: BudgetRow[] = [
  { category: 'Housing', planned: 18000, spent: 14320, remaining: 3680, status: 'on-track' },
  { category: 'Groceries', planned: 6000, spent: 8890, remaining: -2890, status: 'over' },
  { category: 'Transport', planned: 4000, spent: 4510, remaining: -510, status: 'warning' },
  { category: 'Dining', planned: 2500, spent: 3640, remaining: -1140, status: 'warning' },
  { category: 'Health', planned: 2000, spent: 2325, remaining: -325, status: 'warning' },
]

function money(value: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value / 100)
}

export function BudgetPage() {
  const totalPlanned = rows.reduce((sum, row) => sum + row.planned, 0)
  const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0)
  const totalRemaining = totalPlanned - totalSpent

  return (
    <div className="budget">
      <header className="budget__header">
        <div>
          <p className="muted">Monthly plan</p>
          <h1>Budget</h1>
        </div>
        <button type="button" className="button">
          Add category limit
        </button>
      </header>

      <p className="preview-banner" role="note">
        Preview with sample numbers — this page isn't connected to your statements yet.
      </p>

      <section className="card">
        <div className="budget__summary">
          <div className="budget__stat">
            <span>Planned</span>
            <strong>{money(totalPlanned)}</strong>
          </div>
          <div className="budget__stat">
            <span>Spent</span>
            <strong>{money(totalSpent)}</strong>
          </div>
          <div className="budget__stat">
            <span>Remaining</span>
            <strong>{money(totalRemaining)}</strong>
          </div>
          <div className="budget__stat warning">
            <span>Coverage</span>
            <strong>Partial</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="budget__toolbar">
          <h2 className="section-title">Category limits</h2>
          <div className="budget__month-picker" aria-label="Budget month controls">
            <button type="button" className="button button--ghost">Previous</button>
            <strong>October 2026</strong>
            <button type="button" className="button button--ghost">Next</button>
          </div>
        </div>

        <ul className="budget__list">
          {rows.map((row) => (
            <li key={row.category}>
              <div className="budget__item-meta">
                <strong>{row.category}</strong>
                <small>{money(row.planned)} planned</small>
              </div>
              <div className="budget__item-values">
                <span>{money(row.spent)} spent</span>
                <strong className={row.status === 'over' || row.status === 'warning' ? 'negative' : 'positive'}>
                  {money(row.remaining)} left
                </strong>
              </div>
              <span className={`budget__tag budget__tag--${row.status}`}>
                {row.status === 'on-track' ? 'On track' : row.status === 'warning' ? 'Near limit' : 'Exceeded'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
