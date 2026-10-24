import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBackend, signedInRoutes, type FakeRequest } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'
import type { SpendingSummary, Transaction, TransactionDetail } from '../lib/useApi'

const categories = [
  { id: 'cat-groceries', key: 'groceries', name: 'Groceries', isSystem: true },
  { id: 'cat-rent', key: 'housing', name: 'Rent & bond', isSystem: true },
]

const summary = (over: Partial<SpendingSummary> = {}): SpendingSummary => ({
  month: '2026-09',
  moneyIn: 2500000,
  moneyOut: 895000,
  netCashFlow: 1605000,
  refunds: 0,
  transfers: 100000,
  unclassifiedIn: 0,
  transactionCount: 3,
  categories: [
    { categoryId: 'cat-rent', name: 'Rent & bond', total: 850000, count: 1, share: 0.95, previousTotal: 850000, changePercent: 0 },
    { categoryId: 'cat-groceries', name: 'Groceries', total: 45000, count: 1, share: 0.05, previousTotal: 30000, changePercent: 50 },
  ],
  comparison: { month: '2026-08', available: true, reason: null, previousMoneyOut: 880000 },
  coverage: { hasImports: true, statementCount: 1, coversWholeMonth: true, hasWarnings: false },
  trend: [
    { month: '2026-04', moneyIn: 0, moneyOut: 0, coverage: 'none' },
    { month: '2026-05', moneyIn: 0, moneyOut: 0, coverage: 'none' },
    { month: '2026-06', moneyIn: 0, moneyOut: 0, coverage: 'none' },
    { month: '2026-07', moneyIn: 0, moneyOut: 400000, coverage: 'partial' },
    { month: '2026-08', moneyIn: 0, moneyOut: 880000, coverage: 'full' },
    { month: '2026-09', moneyIn: 0, moneyOut: 895000, coverage: 'full' },
  ],
  recurring: [{ description: 'Netflix.com', typicalAmountMinor: 19900, months: 3, lastDate: '2026-09-10', categoryName: 'Subscriptions' }],
  ...over,
})

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  date: '2026-09-01',
  description: 'Checkers Sandton',
  amountMinor: 45000,
  direction: 'outflow',
  transactionType: 'expense',
  categoryId: 'cat-groceries',
  categoryName: 'Groceries',
  excludedFromTotals: false,
  importId: 'imp-1',
  source: { bankName: 'FNB', nickname: 'Cheque' },
  ...over,
})

function spendingBackend(extra: Record<string, (req: FakeRequest) => unknown> = {}) {
  return fakeBackend({
    ...signedInRoutes,
    'GET /api/categories': () => ({ categories }),
    'GET /api/sources': () => ({ sources: [] }),
    'GET /api/spending/summary': () => summary(),
    'GET /api/transactions': (req) => {
      const all = [tx(), tx({ id: 'tx-2', description: 'Rent Example Properties', amountMinor: 850000, categoryId: 'cat-rent', categoryName: 'Rent & bond' })]
      const q = req.query.get('q')?.toLowerCase()
      const rows = all.filter((t) => (!q || t.description.toLowerCase().includes(q)) && (!req.query.get('categoryId') || t.categoryId === req.query.get('categoryId')))
      return { transactions: rows, total: rows.length, offset: 0, limit: 50 }
    },
    ...extra,
  })
}

describe('Spending overview', () => {
  it('shows totals, categories with changes, the trend and regular payments', async () => {
    spendingBackend()
    renderApp('/spending?month=2026-09')
    expect(await screen.findByText('Rent & bond', { selector: '.stat__value' })).toBeInTheDocument()
    expect(screen.getByText('+2% vs last month')).toBeInTheDocument() // money out 8 950 vs 8 800
    expect(screen.getByText(/\+50% vs last month/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /July 2026: R.*partial month/ })).toBeInTheDocument()
    expect(screen.getByText('Netflix.com')).toBeInTheDocument()
    expect(screen.getByText(/An estimate/)).toBeInTheDocument()
  })

  it('filters the list by clicking a category and keeps it in the URL', async () => {
    const { calls } = spendingBackend()
    renderApp('/spending?month=2026-09')
    await userEvent.click(await screen.findByRole('button', { name: /^Groceries/ }))
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/transactions' && c.query.get('categoryId') === 'cat-groceries')).toBe(true),
    )
    expect(await screen.findByText(/1 transaction in September 2026 · Groceries/)).toBeInTheDocument()
  })

  it('searches all of history, not only the current month', async () => {
    const { calls } = spendingBackend()
    renderApp('/spending?month=2026-09')
    await userEvent.click(await screen.findByRole('button', { name: 'All time' }))
    await userEvent.type(screen.getByLabelText('Search transactions'), 'rent')
    await waitFor(() => expect(calls.some((c) => c.path === '/api/transactions' && c.query.get('q') === 'rent')).toBe(true))
    const search = calls.filter((c) => c.path === '/api/transactions' && c.query.get('q') === 'rent').at(-1)!
    expect(search.query.get('month')).toBeNull()
    expect(await screen.findByText(/1 transaction in all your history matching “rent”/)).toBeInTheDocument()
  })

  it("explains when months can't be compared", async () => {
    spendingBackend({
      'GET /api/spending/summary': () =>
        summary({
          coverage: { hasImports: true, statementCount: 1, coversWholeMonth: false, hasWarnings: false },
          comparison: { month: '2026-08', available: false, reason: "This month isn't fully covered by your statements yet.", previousMoneyOut: null },
        }),
    })
    renderApp('/spending?month=2026-09')
    expect(await screen.findByText(/Partial month: your statements don’t cover all of September 2026|Partial month: your statements don't cover all of September 2026/)).toBeInTheDocument()
    expect(screen.getByText(/isn't fully covered by your statements yet/)).toBeInTheDocument()
  })
})

describe('Transaction details', () => {
  const detail = (over: Partial<TransactionDetail> = {}): TransactionDetail => ({
    ...tx(),
    note: null,
    reviewStatus: 'auto_accepted',
    statement: { periodStart: '2026-09-01', periodEnd: '2026-09-30', importedAt: '2026-10-01T10:00:00Z' },
    ...over,
  })

  it('opens from the list and returns with the same filters', async () => {
    spendingBackend({ 'GET /api/transactions/:id': () => ({ transaction: detail() }) })
    renderApp('/spending?month=2026-09&q=check')
    await userEvent.click(await screen.findByRole('link', { name: /Checkers Sandton/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Checkers Sandton' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to spending/ })).toHaveAttribute('href', '/spending?month=2026-09&q=check')
  })

  it('changes the category and can stop counting a transaction', async () => {
    const { calls } = spendingBackend({
      'GET /api/transactions/:id': () => ({ transaction: detail() }),
      'PATCH /api/transactions/:id': () => null,
    })
    renderApp('/spending/tx-1')
    await userEvent.selectOptions(await screen.findByLabelText('Category'), 'cat-rent')
    expect(await screen.findByText(/Category updated/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Count this in my totals and budgets'))
    expect(await screen.findByText('This transaction is not counted in your totals or budgets.')).toBeInTheDocument()
    const patches = calls.filter((c) => c.method === 'PATCH').map((c) => c.body)
    expect(patches).toEqual([{ categoryId: 'cat-rent' }, { excludedFromTotals: true }])
  })

  it('corrects the amount using rand input', async () => {
    const { calls } = spendingBackend({
      'GET /api/transactions/:id': () => ({ transaction: detail() }),
      'PATCH /api/transactions/:id': () => null,
    })
    renderApp('/spending/tx-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Correct details' }))
    const amount = screen.getByLabelText('Amount (R)')
    await userEvent.clear(amount)
    await userEvent.type(amount, '1 234,50')
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ amountMinor: 123450, direction: 'outflow' })
  })

  it('asks before deleting', async () => {
    const { calls } = spendingBackend({
      'GET /api/transactions/:id': () => ({ transaction: detail() }),
      'DELETE /api/transactions/:id': () => null,
    })
    renderApp('/spending/tx-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete transaction' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Spending' })).toBeInTheDocument()
    expect(within(document.body).queryByText('Delete transaction')).not.toBeInTheDocument()
  })
})
