import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiError, fakeBackend, signedInRoutes } from '../../test/fakeBackend'
import { renderApp } from '../../test/renderApp'
import type { ReviewRow, StatementSummary } from '../../lib/useApi'

const summary = (over: Partial<StatementSummary> = {}): StatementSummary => ({
  id: 'imp-1',
  bankFormat: 'fnb',
  bankName: 'FNB',
  nickname: 'Cheque',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  status: 'needs_review',
  transactionCount: 0,
  importedAt: null,
  createdAt: '2026-10-24T10:00:00Z',
  warnings: [],
  validation: {
    parser: 'column-v2',
    detectedBank: 'FNB',
    layoutDetected: true,
    newestFirst: false,
    rowsSkipped: 0,
    feeRows: 0,
    columnTotalsCheck: 'unavailable',
    balanceCheck: 'passed',
    totalsCheck: 'passed',
    mismatchedRows: 0,
    openingBalanceMinor: 500000,
    closingBalanceMinor: 455000,
    periodSource: 'statement',
    rowCount: 2,
  },
  ...over,
})

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  id: 'row-1',
  rowIndex: 0,
  date: '2026-09-01',
  description: 'Checkers Sandton',
  amountMinor: 45000,
  direction: 'outflow',
  categoryId: 'cat-groceries',
  transactionType: 'expense',
  reviewStatus: 'auto_accepted',
  extractionConfidence: 0.98,
  categoryConfidence: 0.85,
  include: true,
  channel: 'card_purchase',
  channelLabel: 'Card purchase',
  flags: [],
  duplicateDecision: null,
  duplicateOf: null,
  ...over,
})

const categories = [
  { id: 'cat-groceries', key: 'groceries', name: 'Groceries', isSystem: true },
  { id: 'cat-shopping', key: 'shopping', name: 'Shopping & clothing', isSystem: true },
]

describe('Statements overview', () => {
  it('shows an empty state with an upload button', async () => {
    fakeBackend({ ...signedInRoutes, 'GET /api/statements': () => ({ statements: [] }) })
    renderApp('/statements')
    expect(await screen.findByRole('heading', { name: 'No statements yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload your first statement' })).toHaveAttribute('href', '/statements/upload')
  })

  it('lists imports with their status and filters them', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/statements': () => ({
        statements: [
          summary(),
          summary({ id: 'imp-2', bankName: 'Capitec', nickname: null, status: 'imported', transactionCount: 4, importedAt: '2026-10-20T10:00:00Z' }),
        ],
      }),
    })
    renderApp('/statements')
    expect(await screen.findByText('Needs review', { selector: '.status-badge' })).toBeInTheDocument()
    expect(screen.getByText('4 saved transactions')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'imported')
    expect(screen.queryByText('FNB')).not.toBeInTheDocument()
    expect(screen.getByText('Capitec')).toBeInTheDocument()
  })
})

describe('Upload', () => {
  it('rejects non-PDF files before uploading', async () => {
    const { calls } = fakeBackend({ ...signedInRoutes, 'GET /api/statements/formats': () => ({ formats: [] }) })
    const { container } = renderApp('/statements/upload')
    await screen.findByRole('heading', { name: 'Upload a statement' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false })
    expect(screen.getByText(/Choose a PDF file/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read statement' })).toBeDisabled()
    expect(calls.some((c) => c.path === '/api/statements/upload')).toBe(false)
  })

  it('uploads a PDF and opens the review screen', async () => {
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/statements/formats': () => ({ formats: [{ key: 'fnb', name: 'FNB', status: 'beta' }] }),
      'POST /api/statements/upload': () => ({ importId: 'imp-1', rowCount: 2, needsReview: 1, duplicates: 0, warnings: [] }),
      'GET /api/statements/:id': () => ({ statement: summary(), reviewing: true, rows: [row()] }),
      'GET /api/categories': () => ({ categories }),
    })
    const { container } = renderApp('/statements/upload')
    await screen.findByRole('option', { name: 'FNB' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['%PDF-1.7'], 'sep.pdf', { type: 'application/pdf' }))
    await userEvent.selectOptions(screen.getByLabelText('Bank'), 'fnb')
    await userEvent.click(screen.getByRole('button', { name: 'Read statement' }))

    expect(await screen.findByText(/We found/)).toHaveTextContent('We found 2 transactions. 1 need a quick check')
    const upload = calls.find((c) => c.path === '/api/statements/upload')!
    expect(upload.body).toBeInstanceOf(FormData)
    expect((upload.body as FormData).get('bankFormat')).toBe('fnb')
    expect(upload.headers.get('Authorization')).toBe('Bearer test-access-token')
  })

  it('shows why a PDF could not be read', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/statements/formats': () => ({ formats: [] }),
      'POST /api/statements/upload': () => apiError(422, 'pdf_encrypted', 'This PDF is password-protected.'),
    })
    const { container } = renderApp('/statements/upload')
    await screen.findByRole('heading', { name: 'Upload a statement' })
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This PDF is password-protected.')
  })

  it('points to the earlier upload when the same file is uploaded again', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/statements/formats': () => ({ formats: [] }),
      'POST /api/statements/upload': () =>
        apiError(409, 'duplicate_statement', "You've already imported this exact statement.", { existingImportId: 'imp-old' }),
    })
    const { container } = renderApp('/statements/upload')
    await screen.findByRole('heading', { name: 'Upload a statement' })
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("You've already imported this exact statement.")
    expect(screen.getByRole('link', { name: 'Open the earlier upload' })).toHaveAttribute('href', '/statements/imp-old')
  })

  it('lists which banks have bank-specific rules', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/statements/formats': () => ({
        formats: [
          { key: 'capitec', name: 'Capitec', status: 'beta', support: 'layout_rules', notes: 'Money in / Money out / Fee / Balance layout.' },
          { key: 'investec', name: 'Investec', status: 'beta', support: 'generic', notes: null },
        ],
      }),
    })
    renderApp('/statements/upload')
    expect(await screen.findByText(/Money in \/ Money out \/ Fee \/ Balance layout/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Investec (general rules)' })).toBeInTheDocument()
  })
})

describe('Review and import', () => {
  it('edits a category, then imports and shows the saved result', async () => {
    let imported = false
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/categories': () => ({ categories }),
      'GET /api/statements/:id': () =>
        imported
          ? { statement: summary({ status: 'imported', transactionCount: 1 }), reviewing: false, rows: [{ ...row(), reviewStatus: 'user_edited' }] }
          : { statement: summary(), reviewing: true, rows: [row({ reviewStatus: 'needs_review', categoryConfidence: 0.3 })] },
      'PATCH /api/statements/:id/rows/:rowId': () => null,
      'POST /api/statements/:id/confirm': () => {
        imported = true
        return { saved: 1 }
      },
    })
    renderApp('/statements/imp-1')
    const select = await screen.findByLabelText('Category for Checkers Sandton')
    await userEvent.selectOptions(select, 'cat-shopping')
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.path).toBe('/api/statements/imp-1/rows/row-1')
    expect(patch.body).toEqual({ categoryId: 'cat-shopping' })

    await userEvent.click(screen.getByRole('button', { name: 'Import 1 transactions' }))
    expect(await screen.findByText(/Imported 1 transaction\./)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /Saved transactions/ })).toBeInTheDocument()
  })

  it('blocks importing until possible duplicates are decided', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/categories': () => ({ categories }),
      'GET /api/statements/:id': () => ({
        statement: summary(),
        reviewing: true,
        rows: [
          row({
            reviewStatus: 'needs_review',
            duplicateDecision: 'unresolved',
            duplicateOf: { id: 't-9', date: '2026-09-01', description: 'Checkers Sandton', amountMinor: 45000, direction: 'outflow', reason: 'Same date.' },
          }),
        ],
      }),
      'PATCH /api/statements/:id/rows/:rowId': () => null,
    })
    renderApp('/statements/imp-1')
    const importButton = await screen.findByRole('button', { name: /Import 1 transactions/ })
    expect(importButton).toBeDisabled()
    expect(screen.getByText(/Decide on 1 possible duplicate/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /duplicate — skip it/ }))
    expect(screen.getByRole('button', { name: /Import 0 transactions/ })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'excluded')
    const excludedRow = screen.getByText('Checkers Sandton', { selector: '.review-row__text strong' }).closest('li')!
    expect(excludedRow).toHaveClass('review-row--excluded')
    expect(within(excludedRow).getByRole('button', { name: /duplicate — skip it/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows row checks, and imports only after flagged rows are checked and warnings acknowledged', async () => {
    const mismatch = row({
      id: 'row-2',
      rowIndex: 1,
      description: 'Engen Fuel',
      reviewStatus: 'needs_review',
      extractionConfidence: 0.4,
      flags: [{ code: 'balance_mismatch', label: "Doesn't match the running balance", blocking: true }],
    })
    const { calls } = fakeBackend({
      ...signedInRoutes,
      'GET /api/categories': () => ({ categories }),
      'GET /api/statements/:id': () => ({
        statement: summary({ warnings: ["1 row(s) don't match the running balance."], validation: { ...summary().validation, balanceCheck: 'mismatch', mismatchedRows: 1 } }),
        reviewing: true,
        rows: [row(), mismatch],
      }),
      'PATCH /api/statements/:id/rows/:rowId': () => null,
      'POST /api/statements/:id/confirm': () => ({ saved: 2 }),
    })
    renderApp('/statements/imp-1')
    expect(await screen.findByText("Doesn't match the running balance")).toBeInTheDocument()
    expect(screen.getByText('Low confidence')).toBeInTheDocument()
    expect(screen.getByText(/Card purchase/, { selector: 'small' })).toBeInTheDocument()

    const importButton = screen.getByRole('button', { name: 'Import 2 transactions' })
    expect(importButton).toBeDisabled()
    expect(screen.getByText('Check 1 row marked for review first.')).toBeInTheDocument()
    // Balance mismatches can't be waved through in bulk
    expect(screen.queryByRole('button', { name: 'Mark all as checked' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(importButton).toBeDisabled() // warnings still need acknowledging
    await userEvent.click(screen.getByLabelText(/read the warnings above/))
    expect(importButton).toBeEnabled()
    await userEvent.click(importButton)
    await screen.findByText(/Imported 2 transactions/)
    expect(calls.find((c) => c.path === '/api/statements/imp-1/confirm')!.body).toEqual({ acknowledgeWarnings: true })
  })

  it('tells the user the totals are from the statement, not a live balance', async () => {
    fakeBackend({
      ...signedInRoutes,
      'GET /api/categories': () => ({ categories }),
      'GET /api/statements/:id': () => ({ statement: summary(), reviewing: true, rows: [row()] }),
    })
    renderApp('/statements/imp-1')
    expect(await screen.findByText(/not a live bank balance/)).toBeInTheDocument()
    expect(screen.getByText('Every row matches')).toBeInTheDocument()
  })
})
