import './SpendingPage.css'

type TransactionType = 'expense' | 'income' | 'transfer' | 'refund'

type CategorySpend = {
  name: string
  total: number
  delta?: number
}

type TransactionItem = {
  id: string
  date: string
  description: string
  category: string
  type: TransactionType
  amount: number
  source: string
}

const categorySpends: CategorySpend[] = [
  { name: 'Housing', total: 14320, delta: 4 },
  { name: 'Groceries', total: 8890, delta: -8 },
  { name: 'Transport', total: 4510, delta: 12 },
  { name: 'Dining', total: 3640, delta: 6 },
  { name: 'Health', total: 2325, delta: -2 },
]

const transactions: TransactionItem[] = [
  {
    id: 't1',
    date: '2026-10-22',
    description: 'Pick n Pay',
    category: 'Groceries',
    type: 'expense',
    amount: 1242,
    source: 'FNB Main account',
  },
  {
    id: 't2',
    date: '2026-10-20',
    description: 'Petrol',
    category: 'Transport',
    type: 'expense',
    amount: 820,
    source: 'FNB Main account',
  },
  {
    id: 't3',
    date: '2026-10-18',
    description: 'Salary',
    category: 'Income',
    type: 'income',
    amount: 24000,
    source: 'Employer payroll',
  },
  {
    id: 't4',
    date: '2026-10-14',
    description: 'Uber Eats',
    category: 'Dining',
    type: 'expense',
    amount: 368,
    source: 'FNB Main account',
  },
  {
    id: 't5',
    date: '2026-10-09',
    description: 'Transfer to savings',
    category: 'Transfers',
    type: 'transfer',
    amount: 3000,
    source: 'FNB Main account',
  },
]

function money(value: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value / 100)
}

export function SpendingPage() {
  const totalSpending = categorySpends.reduce((sum, item) => sum + item.total, 0)

  return (
    <div className="spending">
      <header className="spending__header">
        <div>
          <p className="muted">Category breakdown</p>
          <h1>Spending</h1>
        </div>
        <div className="spending__month-picker" aria-label="Monthly summary controls">
          <button type="button" className="button button--ghost">Previous</button>
          <strong>October 2026</strong>
          <button type="button" className="button button--ghost">Next</button>
        </div>
      </header>

      <p className="preview-banner" role="note">
        Preview with sample numbers — this page isn't connected to your statements yet.
      </p>

      <section className="spending__topbar card">
        <div className="spending__search">
          <label htmlFor="spending-search" className="visually-hidden">Search transactions</label>
          <input id="spending-search" type="search" placeholder="Search descriptions or categories" />
        </div>
        <div className="spending__filters" aria-label="Spending filters">
          <button type="button" className="filter-chip active">All</button>
          <button type="button" className="filter-chip">Expenses</button>
          <button type="button" className="filter-chip">Income</button>
          <button type="button" className="filter-chip">Transfers</button>
        </div>
      </section>

      <section className="card">
        <div className="spending__summary">
          <div className="spending__stat">
            <span>Monthly spend</span>
            <strong>{money(totalSpending)}</strong>
          </div>
          <div className="spending__stat">
            <span>Top category</span>
            <strong>Housing</strong>
          </div>
          <div className="spending__stat">
            <span>Transactions</span>
            <strong>{transactions.length}</strong>
          </div>
          <div className="spending__stat warning">
            <span>Coverage</span>
            <strong>Partial</strong>
          </div>
        </div>
      </section>

      <div className="spending__content">
        <section className="card">
          <h2 className="section-title">Category totals</h2>
          <ul className="spending__list">
            {categorySpends.map((category) => (
              <li key={category.name}>
                <div>
                  <strong>{category.name}</strong>
                  <small>{category.delta != null ? `${category.delta > 0 ? '+' : ''}${category.delta}% vs last month` : 'No comparison'}</small>
                </div>
                <strong>{money(category.total)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="section-title">Recent activity</h2>
          <ul className="spending__transactions">
            {transactions.map((transaction) => (
              <li key={transaction.id}>
                <div className="transaction-main">
                  <strong>{transaction.description}</strong>
                  <small>
                    {transaction.date} · {transaction.category} · {transaction.source}
                  </small>
                </div>
                <div className={`transaction-amount ${transaction.type === 'income' ? 'positive' : 'negative'}`}>
                  {transaction.type === 'income' ? '+' : '-'}
                  {money(transaction.amount)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
