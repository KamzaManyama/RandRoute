import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { pageList } from '../lib/paging'
import { Pagination } from './Pagination'
import { fakeBackend, signedInRoutes } from '../test/fakeBackend'
import { renderApp } from '../test/renderApp'
import type { ReviewRow, Transaction } from '../lib/useApi'

describe('pageList', () => {
  it('shows every page when there are few', () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5])
  })
  it('collapses long ranges around the current page', () => {
    expect(pageList(1, 20)).toEqual([1, 2, 3, 4, '…', 20])
    expect(pageList(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20])
    expect(pageList(20, 20)).toEqual([1, '…', 17, 18, 19, 20])
  })
})

describe('Pagination', () => {
  it('hides itself when everything fits on one page', () => {
    const { container } = render(<Pagination page={1} pageSize={25} total={10} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the range and disables Previous on the first page', async () => {
    const pages: number[] = []
    render(<Pagination page={1} pageSize={25} total={124} onChange={(p) => pages.push(p)} />)
    expect(screen.getByText('Showing 1–25 of 124')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: 'Page 5' }))
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(pages).toEqual([5, 2])
  })
})

const tx = (i: number): Transaction => ({
  id: `tx-${i}`,
  date: '2026-09-01',
  description: `Purchase ${i}`,
  amountMinor: 1000 + i,
  direction: 'outflow',
  transactionType: 'expense',
  categoryId: null,
  categoryName: null,
  excludedFromTotals: false,
  importId: 'imp-1',
  source: null,
})

describe('paged lists in the app', () => {
  it('Spending loads transactions one page at a time from the server', async () => {
    const all = Array.from({ length: 60 }, (_, i) => tx(i + 1))
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/categories': () => ({ categories: [] }),
      'GET /api/sources': () => ({ sources: [] }),
      'GET /api/spending/summary': () => ({
        month: '2026-09', moneyIn: 0, moneyOut: 0, netCashFlow: 0, refunds: 0, transfers: 0, unclassifiedIn: 0, transactionCount: 60,
        categories: [], comparison: { month: '2026-08', available: false, reason: null, previousMoneyOut: null },
        coverage: { hasImports: true, statementCount: 1, coversWholeMonth: true, hasWarnings: false }, trend: [], recurring: [],
      }),
      'GET /api/transactions': (req) => {
        const offset = Number(req.query.get('offset') ?? 0)
        const limit = Number(req.query.get('limit') ?? 25)
        return { transactions: all.slice(offset, offset + limit), total: all.length, offset, limit }
      },
    })
    renderApp('/spending?month=2026-09')
    expect(await screen.findByText('Purchase 1')).toBeInTheDocument()
    expect(screen.getByText('Showing 1–6 of 60')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(await screen.findByText('Purchase 13')).toBeInTheDocument()
    expect(screen.queryByText('Purchase 1')).not.toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/api/transactions').at(-1)!.query.get('offset')).toBe('12')

    // Changing a filter starts again from page 1
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'income')
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/transactions').at(-1)!.query.get('type')).toBe('income'))
    expect(calls.filter((c) => c.path === '/api/transactions').at(-1)!.query.get('offset')).toBe('0')
  })

  it('statement review shows 6 rows per page', async () => {
    const rows: ReviewRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`, rowIndex: i, date: '2026-09-01', description: `Row ${i + 1}`, amountMinor: 100, direction: 'outflow',
      categoryId: null, transactionType: 'expense', reviewStatus: 'auto_accepted', extractionConfidence: 1, categoryConfidence: 1,
      include: true, duplicateDecision: null, duplicateOf: null,
    }))
    fakeBackend({
      ...signedInRoutes,
      'GET /api/categories': () => ({ categories: [] }),
      'GET /api/statements/:id': () => ({
        statement: {
          id: 'imp-1', bankFormat: 'fnb', bankName: 'FNB', nickname: null, periodStart: '2026-09-01', periodEnd: '2026-09-30',
          status: 'staged', transactionCount: 0, importedAt: null, createdAt: '2026-10-01', warnings: [],
          validation: { balanceCheck: 'passed', totalsCheck: 'passed', mismatchedRows: 0, openingBalanceMinor: null, closingBalanceMinor: null, periodSource: 'statement', rowCount: 30 },
        },
        reviewing: true,
        rows,
      }),
    })
    renderApp('/statements/imp-1')
    expect(await screen.findByText('Row 6')).toBeInTheDocument()
    expect(screen.queryByText('Row 7')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Page 5' }))
    expect(screen.getByText('Row 30')).toBeInTheDocument()
    // The import still covers every row, not just the visible page
    expect(screen.getByRole('button', { name: 'Import 30 transactions' })).toBeInTheDocument()
  })
})
