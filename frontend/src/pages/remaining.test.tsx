import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBackend, signedInRoutes, testProfile } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'
import type { BudgetView, Insights } from '../lib/useApi'

const categories = [
  { id: 'cat-g', key: 'groceries', name: 'Groceries', isSystem: true },
  { id: 'cat-t', key: 'transport', name: 'Transport & fuel', isSystem: true },
  { id: 'cat-s', key: 'salary', name: 'Salary & wages', isSystem: true },
]

const coverage = { hasImports: true, statementCount: 1, coversWholeMonth: true, hasWarnings: false }

const budgetView = (over: Partial<BudgetView> = {}): BudgetView => ({
  month: '2026-09',
  budget: { id: 'b1', expectedIncomeMinor: 2500000, savingsTargetMinor: 200000 },
  limits: [
    { categoryId: 'cat-g', name: 'Groceries', limitMinor: 300000, spentMinor: 350000, remainingMinor: -50000, status: 'exceeded' },
    { categoryId: 'cat-t', name: 'Transport & fuel', limitMinor: 100000, spentMinor: 40000, remainingMinor: 60000, status: 'on_track' },
  ],
  unbudgeted: [{ categoryId: null, name: 'Uncategorised', spentMinor: 12000 }],
  totals: { plannedMinor: 400000, spentInBudgetMinor: 390000, remainingMinor: 10000, totalSpendingMinor: 402000, refundsMinor: 0 },
  coverage,
  previousMonthHasBudget: false,
  history: { months: 3, averages: [{ categoryId: 'cat-g', name: 'Groceries', averageMinor: 287000 }] },
  ...over,
})

const insights: Insights = {
  month: '2026-09',
  coverage,
  totals: { moneyInMinor: 2500000, moneyOutMinor: 900000, netMinor: 1600000, refundsMinor: 0, unclassifiedInMinor: 0, previousMoneyOutMinor: 800000, moneyOutChangePercent: 13 },
  comparison: { month: '2026-08', available: true, reason: null },
  topCategories: [{ categoryId: 'cat-g', name: 'Groceries', totalMinor: 350000, count: 6 }],
  changes: [{ categoryId: 'cat-g', name: 'Groceries', totalMinor: 350000, previousMinor: 250000, changeMinor: 100000, changePercent: 40 }],
  unusual: [],
  unusualCheck: { available: false, historyMonths: 1, reason: 'We need at least 3 complete earlier months to spot unusual spending (you have 1).' },
  budget: { hasBudget: true, overCount: 1, limits: [] },
  limitations: [],
}

describe('Initial setup', () => {
  it('sends new users to setup first, then into the app', async () => {
    let profile = { ...testProfile, setupCompleted: false }
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/profile': () => ({ profile }),
      'PATCH /api/profile': (req) => {
        profile = { ...profile, setupCompleted: true }
        return { profile, sent: req.body }
      },
    })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Welcome, Maredi' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/how much would you like to save/i), '2000')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Maredi' })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ setupCompleted: true, monthlyBudgetTargetMinor: null, savingsTargetMinor: 200000 })
  })
})

describe('Budget', () => {
  it('shows limits, overspending as negative, and unbudgeted spending', async () => {
    fakeBackend({ ...signedInRoutes, 'GET /api/budgets/:month': () => budgetView() })
    renderApp('/budget?month=2026-09')
    expect(await screen.findByText('Exceeded')).toBeInTheDocument()
    expect(screen.getByText('over')).toBeInTheDocument()
    expect(screen.getByText('Uncategorised')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Groceries/ })).toHaveAttribute('href', '/spending?month=2026-09&category=cat-g')
  })

  it('offers to copy last month when there is no plan', async () => {
    let copied = false
    fakeBackend({
      ...signedInRoutes,
      'GET /api/budgets/:month': () => (copied ? budgetView() : budgetView({ budget: null, limits: [], previousMonthHasBudget: true })),
      'POST /api/budgets/:month/copy-previous': () => {
        copied = true
        return { copied: 2 }
      },
    })
    renderApp('/budget?month=2026-09')
    await userEvent.click(await screen.findByRole('button', { name: /Copy last month/ }))
    expect(await screen.findByText('Exceeded')).toBeInTheDocument()
  })

  it('plans a budget from averages and warns when it exceeds income', async () => {
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/categories': () => ({ categories }),
      'GET /api/budgets/:month': () => budgetView({ budget: null, limits: [] }),
      'PUT /api/budgets/:month': () => ({ budgetId: 'b1' }),
    })
    renderApp('/budget/plan?month=2026-09')
    await userEvent.click(await screen.findByRole('button', { name: 'Fill from my averages' }))
    expect(screen.getByLabelText('Limit for Groceries')).toHaveValue('2900.00') // R2 870 rounded up to R50
    await userEvent.type(screen.getByLabelText(/Expected income/), '2000')
    expect(screen.getByText('Over income by')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      expectedIncomeMinor: 200000,
      savingsTargetMinor: null,
      limits: [{ categoryId: 'cat-g', limitMinor: 290000 }],
    })
  })
})

describe('Insights and AI', () => {
  it('shows calculated insights without calling AI', async () => {
    const { calls } = fakeBackend({ ...signedInRoutes, 'GET /api/insights': () => ({ insights, ai: { available: true } }) })
    renderApp('/insights?month=2026-09')
    expect(await screen.findByText('+13% vs August 2026')).toBeInTheDocument()
    expect(screen.getByText(/need at least 3 complete earlier months/)).toBeInTheDocument()
    expect(calls.some((c) => c.path.includes('explain'))).toBe(false)
  })

  it('opens the Explain page from Insights', async () => {
    fakeBackend({ ...signedInRoutes, 'GET /api/insights': () => ({ insights, ai: { available: true } }) })
    renderApp('/insights?month=2026-09')
    expect(await screen.findByRole('link', { name: 'Explain my spending' })).toHaveAttribute('href', '/insights/explain?month=2026-09')
  })

  it('asks for consent, then streams the steps, the AI thinking and the answer', async () => {
    let profile = { ...testProfile }
    const sse = [
      ['step', { id: 'figures', label: 'Calculated your totals, changes and saving opportunities', state: 'done' }],
      ['step', { id: 'ai', label: 'AI is thinking it through', state: 'active' }],
      ['thought', { text: '**Looking at groceries**\nGroceries went over budget.' }],
      ['step', { id: 'ai', label: 'AI finished thinking', state: 'done' }],
      ['text', { text: 'Where your money went\n- Groceries rose the most.\n' }],
      ['text', { text: 'How you could save\n- Plan meals to save R225.00 a month.' }],
      ['step', { id: 'write', label: 'Explanation ready', state: 'done' }],
      ['done', { generatedAt: '2026-10-24T10:00:00Z' }],
    ]
      .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      .join('')
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/profile': () => ({ profile }),
      'POST /api/profile/ai-consent': () => {
        profile = { ...profile, ai: { ...profile.ai, consent: 'granted' } }
        return { profile }
      },
      'POST /api/insights/explain/stream': () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    })
    renderApp('/insights/explain?month=2026-09')
    await userEvent.click(await screen.findByRole('button', { name: 'Explain my spending' }))
    expect(screen.getByRole('heading', { name: 'Use AI explanations?' })).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/insights/explain/stream')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /I agree/ }))
    expect(await screen.findByText('Plan meals to save R225.00 a month.')).toBeInTheDocument()
    expect(screen.getByText('AI finished thinking')).toBeInTheDocument()
    expect(screen.getByText('AI thinking')).toBeInTheDocument()
    expect(screen.getByText('Looking at groceries')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'How you could save' })).toBeInTheDocument()
    expect(screen.getByText('Written by AI')).toBeInTheDocument()
    expect(screen.queryByText('What was shared with the AI')).not.toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/insights/explain/stream')!.body).toEqual({ month: '2026-09' })
  })

  it('explains when AI is switched off', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/profile': () => ({ profile: { ...testProfile, ai: { ...testProfile.ai, available: false } } }),
      'GET /api/insights': () => ({ insights, ai: { available: false } }),
    })
    renderApp('/insights?month=2026-09')
    expect(await screen.findByText(/AI answers are turned off right now/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explain my spending' })).not.toBeInTheDocument()
  })

})

describe('Profile & privacy', () => {
  it('needs DELETE and a password to delete the account, then signs out', async () => {
    const { calls } = fakeBackend({ ...signedInRoutes, 'POST /api/profile/delete-account': () => null })
    renderApp('/profile')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete my account' }))
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'delete')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete my account' }).at(-1)!)
    expect(screen.getByText('Type DELETE in capitals to confirm.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/profile/delete-account')).toBe(false)

    await userEvent.clear(screen.getByLabelText('Type DELETE to confirm'))
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await userEvent.type(screen.getByLabelText('Your password'), 'Passw0rd!')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete my account' }).at(-1)!)
    expect(await screen.findByRole('heading', { name: 'Welcome to RandRoute' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/profile/delete-account')!.body).toEqual({ confirm: 'DELETE', password: 'Passw0rd!' })
  })

  it('turns AI explanations on from Profile', async () => {
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'POST /api/profile/ai-consent': () => ({ profile: { ...testProfile, ai: { ...testProfile.ai, consent: 'granted' } } }),
    })
    renderApp('/profile')
    await userEvent.click(await screen.findByRole('button', { name: /turn on AI explanations/ }))
    expect(await screen.findByRole('button', { name: 'Turn off AI explanations' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/profile/ai-consent')!.body).toEqual({ granted: true })
  })
})
