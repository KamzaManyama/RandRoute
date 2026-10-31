import type { ReactNode } from 'react'
import type { BudgetReviewData, CoachData, LimitStatus } from '../lib/useApi'
import { monthLabel } from '../lib/format'
import { HealthBadge } from './health'

/*
 * "Exactly what is shared with the AI", written out in plain language.
 * Every figure here is exactly what is sent — only the layout is friendlier.
 */

const COVERAGE: Record<CoachData['coverage'], string> = {
  whole_month: 'The whole month',
  partial_month: 'Part of the month only',
  none: 'No statements yet',
}

const LIMIT_STATUS: Record<LimitStatus, string> = {
  on_track: 'on track',
  near_limit: 'near the limit',
  reached: 'limit reached',
  exceeded: 'over the limit',
}

const pct = (value: number | null) => (value === null ? '—' : `${value}%`)
const change = (value: number | null) => (value === null ? 'new this month' : value > 0 ? `up ${value}%` : value < 0 ? `down ${Math.abs(value)}%` : 'no change')
const notSet = (value: string | null) => (value === null || value === 'not set' ? 'Not set' : value)
const isZero = (value: string) => /^-?R0\.00$/.test(value)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="shared-data__section">
      <h3 className="shared-data__heading">{title}</h3>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="shared-data__rows">
      {rows.map(([label, value]) => (
        <div key={label} className="shared-data__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Items({ items }: { items: ReactNode[] }) {
  return (
    <ul className="shared-data__items">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="shared-data">
      <summary>{title}</summary>
      <div className="shared-data__body">{children}</div>
      <p className="shared-data__never">
        <strong>Never shared:</strong> your transaction descriptions, dates of single purchases, account numbers, name or
        email.
      </p>
    </details>
  )
}

/** The month summary the AI coach sees. */
export function CoachSharedData({ data, title = 'Exactly what is shared with the AI' }: { data: CoachData; title?: string }) {
  const income = data.incomeBreakdown
  const goals = data.goals
  const goalRows: [string, ReactNode][] = []
  if (goals.expectedIncome) goalRows.push(['Usual income', goals.expectedIncome])
  if (goals.savingsTarget)
    goalRows.push([
      'Savings target',
      `${goals.savingsTarget}${goals.savingsTargetMet === null ? '' : goals.savingsTargetMet ? ' — met' : ' — not met yet'}`,
    ])
  if (goals.monthlySpendingTarget) goalRows.push(['Spending target', goals.monthlySpendingTarget])

  const ideas = data.savingOpportunities

  const monthRows: [string, ReactNode][] = [
    ['Statements cover', COVERAGE[data.coverage]],
    ['Money in', data.income],
  ]
  if (!isZero(income.salary)) monthRows.push(['Salary', income.salary])
  if (!isZero(income.sideIncome)) monthRows.push(['Side hustle & extra income', income.sideIncome])
  if (!isZero(income.other)) monthRows.push(['Other income', income.other])
  if (!isZero(data.incomeNotYetMarked)) monthRows.push(['Money in not marked as income yet', data.incomeNotYetMarked])
  monthRows.push(
    ['Money out', data.spending],
    ['Left over', data.net],
    ['Savings rate', pct(data.savingsRatePercent)],
    ['Debit orders', data.debitOrders.count ? `${data.debitOrders.total} across ${data.debitOrders.count}` : 'None found'],
  )

  return (
    <Panel title={title}>
      <Section title={`Your month: ${monthLabel(data.month)}`}>
        <Rows rows={monthRows} />
      </Section>

      <Section title="Money health">
        <p className="shared-data__line">
          <HealthBadge level={data.risk.level} />
          {data.risk.provisional && <span className="muted small"> Early result — the month isn&apos;t complete.</span>}
        </p>
        {data.risk.reasons.length > 0 && <Items items={data.risk.reasons} />}
      </Section>

      {data.topCategories.length > 0 && (
        <Section title="Where your money went">
          <Items
            items={data.topCategories.map((c) => (
              <>
                <strong>{c.category}</strong>: {c.amount}
                {c.sharePercent !== null && <span className="muted"> · {c.sharePercent}% of spending</span>}
              </>
            ))}
          />
        </Section>
      )}

      <Section title="Compared with last month">
        {data.monthOverMonth.available ? (
          <>
            {data.monthOverMonth.spendingChangePercent !== null && (
              <p className="shared-data__line">Total spending {change(data.monthOverMonth.spendingChangePercent)}.</p>
            )}
            {data.monthOverMonth.biggestChanges.length > 0 && (
              <Items
                items={data.monthOverMonth.biggestChanges.map((c) => (
                  <>
                    <strong>{c.category}</strong>: {c.thisMonth} (last month {c.lastMonth}, {change(c.changePercent)})
                  </>
                ))}
              />
            )}
          </>
        ) : (
          <p className="shared-data__line muted">No earlier month to compare with.</p>
        )}
        {data.unusualIncreases.length > 0 && (
          <Items
            items={data.unusualIncreases.map((u) => (
              <>
                <strong>{u.category}</strong> is higher than usual: {u.thisMonth} (usually about {u.usualAverage})
              </>
            ))}
          />
        )}
      </Section>

      <Section title="Budget">
        {data.budget.hasBudget ? (
          <>
            <p className="shared-data__line">
              {data.budget.categoriesOverLimit === 0
                ? 'No categories over their limit.'
                : `${data.budget.categoriesOverLimit} categor${data.budget.categoriesOverLimit === 1 ? 'y' : 'ies'} over the limit.`}
            </p>
            <Items
              items={data.budget.categories.map((c) => (
                <>
                  <strong>{c.category}</strong>: spent {c.spent} of {c.limit} — {LIMIT_STATUS[c.status]}
                </>
              ))}
            />
          </>
        ) : (
          <p className="shared-data__line muted">No budget set for this month.</p>
        )}
      </Section>

      <Section title="Your goals">
        {goalRows.length ? <Rows rows={goalRows} /> : <p className="shared-data__line muted">No goals set.</p>}
      </Section>

      {(ideas.ifYouTrim.length > 0 || ideas.overBudget.length > 0) && (
        <Section title="Saving ideas worked out by RandRoute">
          <Items
            items={[
              ...ideas.ifYouTrim.map((t) => (
                <>
                  <strong>{t.category}</strong> ({t.spentThisMonth}): spending 10% less saves {t.save10PercentPerMonth} a month; 25% less
                  saves {t.save25PercentPerMonth} a month ({t.save25PercentPerYear} a year)
                </>
              )),
              ...ideas.overBudget.map((o) => (
                <>
                  <strong>{o.category}</strong> is {o.overBy} over its limit
                </>
              )),
            ]}
          />
        </Section>
      )}

      {data.limitations.length > 0 && (
        <Section title="Things to keep in mind">
          <Items items={data.limitations} />
        </Section>
      )}
    </Panel>
  )
}

/** The draft plan the AI reviews. */
export function BudgetSharedData({ data, title = 'What was shared' }: { data: BudgetReviewData; title?: string }) {
  return (
    <Panel title={title}>
      <Section title={`Your plan for ${monthLabel(data.month)}`}>
        <Rows
          rows={[
            ['Expected income', notSet(data.expectedIncome)],
            ['Savings target', notSet(data.savingsTarget)],
            ['Planned spending', data.totalPlanned],
            ['Planned spending plus savings', data.plannedPlusSavings],
            ['Left over', notSet(data.leftOverAfterPlanAndSavings)],
          ]}
        />
      </Section>
      {data.categories.length > 0 && (
        <Section title="Category limits">
          <Items
            items={data.categories.map((c) => (
              <>
                <strong>{c.category}</strong>: limit {c.limit}
                <span className="muted">
                  {' '}
                  · {c.recentMonthlyAverage === 'not set' ? 'no recent spending' : `you usually spend ${c.recentMonthlyAverage}`}
                </span>
              </>
            ))}
          />
        </Section>
      )}
    </Panel>
  )
}
