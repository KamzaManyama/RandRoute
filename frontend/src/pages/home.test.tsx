import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { emptyDashboard, fakeBackend, signedInRoutes } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'

const withData = {
  ...emptyDashboard,
  month: '2026-10',
  moneyIn: 2650000,
  moneyOut: 2120000,
  netCashFlow: 530000,
  income: { salary: 2500000, side: 150000, other: 0 },
  debitOrders: { total: 184900, count: 4 },
  savingsRate: { basisPoints: 2000, percent: 20 },
  health: {
    level: 'healthy',
    provisional: false,
    reasons: [{ code: 'good_savings', tone: 'good', text: '20% of your income was left after spending.' }],
  },
  goals: { expectedIncomeMinor: null, savingsTargetMinor: 500000, monthlySpendingTargetMinor: null, savingsTargetMet: true },
  budget: { hasBudget: true, overCount: 1 },
  coverage: { hasImports: true, statementCount: 1, coversWholeMonth: true, hasWarnings: false },
  topCategories: [{ categoryId: 'cat-g', name: 'Groceries', total: 412000, count: 9, sharePercent: 19 }],
  recentTransactions: [
    { id: 't1', date: '2026-10-02', description: 'Debit Order Clientele', amountMinor: 18900, direction: 'outflow', transactionType: 'expense', channelLabel: 'Debit order', categoryName: 'Insurance' },
  ],
}

describe('Home dashboard', () => {
  it('shows savings rate, money health, income sources and debit orders from the backend', async () => {
    fakeBackend({ ...signedInRoutes, 'GET /api/dashboard/summary': () => withData })
    renderApp('/')
    expect(await screen.findByText('20%')).toBeInTheDocument()
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(screen.getByText('20% of your income was left after spending.')).toBeInTheDocument()
    expect(screen.getByText('Side hustle & extra income')).toBeInTheDocument()
    expect(screen.getByText(/4 fixed commitments this month/)).toBeInTheDocument()
    expect(screen.getByText(/met this month/)).toBeInTheDocument()
    expect(screen.getByText('1 over limit')).toBeInTheDocument()
    expect(screen.getByText(/19% of spending/)).toBeInTheDocument()
    expect(screen.getByText(/Insurance · Debit order/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /AI coach/ }).some((l) => l.getAttribute('href')?.startsWith('/coach?month='))).toBe(true)
  })

  it('labels a partial month and never shows a health level it can not support', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/dashboard/summary': () => ({
        ...withData,
        coverage: { ...withData.coverage, coversWholeMonth: false },
        health: { level: 'not_enough_data', provisional: true, reasons: [{ code: 'no_income', tone: 'info', text: 'No income was found for this month, so we can’t work out a savings rate.' }] },
        savingsRate: { basisPoints: null, percent: null },
      }),
    })
    renderApp('/')
    expect(await screen.findByText(/Partial month/)).toBeInTheDocument()
    expect(screen.getByText('Not enough data')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('invites a first import when there is no data', async () => {
    fakeBackend(signedInRoutes)
    renderApp('/')
    expect(await screen.findByRole('link', { name: 'Upload a statement' })).toHaveAttribute('href', '/statements/upload')
    expect(screen.queryByText('Money health')).not.toBeInTheDocument()
  })
})
