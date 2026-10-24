import { useState } from 'react'
import { currentMonth, money } from '../lib/format'
import { MonthPicker, PageHeader, ShareBar, Stat, Stats } from '../components/ui'

type BudgetRow = { category: string; planned: number; spent: number }

// Sample numbers until budgets are connected (Roadmap phase 5).
const rows: BudgetRow[] = [
  { category: 'Rent & bond', planned: 1800000, spent: 1432000 },
  { category: 'Groceries', planned: 600000, spent: 889000 },
  { category: 'Transport & fuel', planned: 400000, spent: 451000 },
  { category: 'Eating out & takeaways', planned: 250000, spent: 164000 },
  { category: 'Medical & pharmacy', planned: 200000, spent: 32500 },
]

function status(row: BudgetRow) {
  const used = row.spent / row.planned
  if (used > 1) return { label: 'Exceeded', tone: 'status--bad' }
  if (used >= 0.9) return { label: 'Near limit', tone: 'status--warn' }
  return { label: 'On track', tone: 'status--good' }
}

/** Screen 12 — Monthly budget (preview). */
export function BudgetPage() {
  const [month, setMonth] = useState(currentMonth)
  const planned = rows.reduce((s, r) => s + r.planned, 0)
  const spent = rows.reduce((s, r) => s + r.spent, 0)

  return (
    <div className="page">
      <PageHeader
        eyebrow="Monthly plan"
        title="Budget"
        actions={
          <>
            <MonthPicker month={month} onChange={setMonth} />
            <button type="button" className="button" disabled>
              Add category limit
            </button>
          </>
        }
      />

      <p className="preview-banner" role="note">
        Preview with sample numbers — this page isn&apos;t connected to your statements yet.
      </p>

      <Stats label="Budget totals">
        <Stat label="Planned" value={money(planned)} />
        <Stat label="Spent" value={money(spent)} />
        <Stat label="Remaining" value={money(planned - spent)} tone={planned - spent < 0 ? 'negative' : undefined} />
        <Stat label="Coverage" value="Partial" tone="warn" />
      </Stats>

      <section className="card">
        <h2 className="section-title">Category limits</h2>
        <ul className="list">
          {rows.map((row) => {
            const s = status(row)
            const remaining = row.planned - row.spent
            return (
              <li key={row.category} className="list-row">
                <span className="list-row__main">
                  <span className="list-row__title">{row.category}</span>
                  <ShareBar share={row.spent / row.planned} label={`${Math.round((row.spent / row.planned) * 100)}% of limit used`} />
                  <span className="list-row__meta">
                    {money(row.spent)} of {money(row.planned)} · <span className={`status-badge ${s.tone}`}>{s.label}</span>
                  </span>
                </span>
                <span className={`list-row__value ${remaining < 0 ? 'negative' : ''}`}>
                  {money(remaining)}
                  <small>{remaining < 0 ? 'over' : 'left'}</small>
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
