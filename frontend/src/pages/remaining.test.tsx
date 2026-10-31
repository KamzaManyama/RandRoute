import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiError, fakeBackend, signedInRoutes, testProfile } from '../test/fakeBackend'
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
  totals: {
    moneyInMinor: 2500000,
    moneyOutMinor: 900000,
    netMinor: 1600000,
    refundsMinor: 0,
    unclassifiedInMinor: 0,
    previousMoneyOutMinor: 800000,
    moneyOutChangePercent: 13,
    income: { salary: 2500000, side: 0, other: 0 },
    debitOrders: { total: 120000, count: 3 },
    transfersMinor: 0,
  },
  savingsRate: { basisPoints: 6400, percent: 64 },
  health: {
    level: 'watch',
    provisional: false,
    reasons: [
      { code: 'good_savings', tone: 'good', text: '64% of your income was left after spending.' },
      { code: 'over_budget', tone: 'warning', text: '1 budget category is over the limit.' },
    ],
  },
  goals: { expectedIncomeMinor: null, savingsTargetMinor: null, monthlySpendingTargetMinor: null, savingsTargetMet: null },
  comparison: { month: '2026-08', available: true, reason: null },
  topCategories: [{ categoryId: 'cat-g', name: 'Groceries', totalMinor: 350000, count: 6, sharePercent: 39 }],
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
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      setupCompleted: true,
      expectedMonthlyIncomeMinor: null,
      monthlyBudgetTargetMinor: null,
      savingsTargetMinor: 200000,
    })
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

const coachInput = {
  month: '2026-09',
  currency: 'ZAR',
  coverage: 'whole_month',
  income: 'R25 000.00',
  spending: 'R9 000.00',
  net: 'R16 000.00',
  savingsRatePercent: 64,
  risk: { level: 'watch', provisional: false, reasons: ['1 budget category is over the limit.'] },
}

const coachResult = {
  coach: {
    summary: 'R25 000.00 came in and R9 000.00 went out, so 64% of your income was left.',
    positives: ['You kept most of your income.', 'Transport stayed within budget.', 'No unusual spending.'],
    concerns: ['Groceries went over budget.', 'Groceries rose the most.', 'Three debit orders run every month.'],
    actions: ['Plan meals before shopping.', 'Set a grocery limit you can keep.', 'Review your debit orders.'],
    motivation: 'Small changes add up.',
  },
  verification: { numbersChecked: 3, pointsRemoved: 0, attempts: 1 },
  basedOn: coachInput,
  generatedAt: '2026-10-24T10:00:00Z',
  source: 'ai_generated',
}

describe('Insights and AI coach', () => {
  it('shows calculated insights, savings rate and money health without calling AI', async () => {
    const { calls } = fakeBackend({ ...signedInRoutes, 'GET /api/insights': () => ({ insights, ai: { available: true } }) })
    renderApp('/insights?month=2026-09')
    expect(await screen.findByText('+13% vs August 2026')).toBeInTheDocument()
    expect(screen.getByText(/need at least 3 complete earlier months/)).toBeInTheDocument()
    expect(screen.getByText('64%')).toBeInTheDocument()
    expect(screen.getByText('Worth watching')).toBeInTheDocument()
    expect(screen.getByText('1 budget category is over the limit.')).toBeInTheDocument()
    expect(calls.some((c) => c.path.includes('coach'))).toBe(false)
  })

  it('opens the AI coach from Insights', async () => {
    fakeBackend({ ...signedInRoutes, 'GET /api/insights': () => ({ insights, ai: { available: true } }) })
    renderApp('/insights?month=2026-09')
    expect(await screen.findByRole('link', { name: 'Ask the AI coach' })).toHaveAttribute('href', '/coach?month=2026-09')
  })

  it('shows what will be shared, asks for consent, then shows the checked, labelled answer', async () => {
    let profile = { ...testProfile }
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/profile': () => ({ profile }),
      'POST /api/profile/ai-consent': () => {
        profile = { ...profile, ai: { ...profile.ai, consent: 'granted' } }
        return { profile }
      },
      'GET /api/coach/preview': () => ({ input: coachInput, ai: { available: true } }),
      'POST /api/coach': () => coachResult,
    })
    renderApp('/coach?month=2026-09')
    expect(await screen.findByText('Exactly what is shared with the AI')).toBeInTheDocument()
    expect(screen.getAllByText('R25 000.00').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Coach me on September 2026' }))
    expect(screen.getByRole('heading', { name: 'Use the AI coach?' })).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/coach')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /I agree/ }))
    expect(await screen.findByText(coachResult.coach.summary)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What went well' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What to watch' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeInTheDocument()
    expect(screen.getByText('Plan meals before shopping.')).toBeInTheDocument()
    expect(screen.getByText('Small changes add up.')).toBeInTheDocument()
    expect(screen.getByText('Written by AI')).toBeInTheDocument()
    expect(screen.getByText(/Checked 3 figures against your calculated totals/)).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/coach')!.body).toEqual({ month: '2026-09' })
  })

  it('says so when the AI answer could not be verified', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/profile': () => ({ profile: { ...testProfile, ai: { ...testProfile.ai, consent: 'granted' } } }),
      'GET /api/coach/preview': () => ({ input: coachInput, ai: { available: true } }),
      'POST /api/coach': () =>
        apiError(502, 'ai_unverified', "The AI answer couldn't be checked against your figures, so we didn't show it."),
    })
    renderApp('/coach?month=2026-09')
    await userEvent.click(await screen.findByRole('button', { name: 'Coach me on September 2026' }))
    expect(await screen.findByText(/couldn't be checked against your figures/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('redirects the old explain address to the coach', async () => {
    fakeBackend({ ...signedInRoutes, 'GET /api/coach/preview': () => ({ input: coachInput, ai: { available: true } }) })
    renderApp('/insights/explain?month=2026-09')
    expect(await screen.findByRole('heading', { name: 'Your September 2026, explained' })).toBeInTheDocument()
  })

  it('explains when AI is switched off', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/profile': () => ({ profile: { ...testProfile, ai: { ...testProfile.ai, available: false } } }),
      'GET /api/insights': () => ({ insights, ai: { available: false } }),
    })
    renderApp('/insights?month=2026-09')
    expect(await screen.findByText(/AI coaching is turned off right now/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ask the AI coach' })).not.toBeInTheDocument()
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
