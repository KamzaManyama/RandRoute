import { useMemo } from 'react'
import { useAuth } from '../auth/useAuth'
import type { DashboardSummary } from './api'

export type StatementStatus = 'staged' | 'needs_review' | 'imported' | 'partial' | 'failed' | 'cancelled'
export type TransactionType = 'income' | 'expense' | 'transfer' | 'refund' | 'unknown'
export type Direction = 'inflow' | 'outflow'

export type StatementSummary = {
  id: string
  bankFormat: string
  bankName: string
  nickname: string | null
  periodStart: string
  periodEnd: string
  status: StatementStatus
  transactionCount: number
  importedAt: string | null
  createdAt: string
  warnings: string[]
  validation: {
    balanceCheck: 'passed' | 'mismatch' | 'unavailable'
    totalsCheck: 'passed' | 'failed' | 'unavailable'
    mismatchedRows: number
    openingBalanceMinor: number | null
    closingBalanceMinor: number | null
    periodSource: 'user' | 'statement' | 'transactions'
    rowCount: number
  }
}

export type ReviewRow = {
  id: string
  rowIndex: number
  date: string
  description: string
  amountMinor: number
  direction: Direction
  categoryId: string | null
  transactionType: TransactionType
  reviewStatus: 'auto_accepted' | 'needs_review' | 'user_confirmed' | 'user_edited'
  extractionConfidence: number | null
  categoryConfidence: number | null
  include: boolean
  duplicateDecision: 'unresolved' | 'keep_both' | 'exclude' | null
  duplicateOf: {
    id: string
    date: string
    description: string
    amountMinor: number
    direction: Direction
    reason: string
  } | null
}

export type SavedRow = {
  id: string
  date: string
  description: string
  amountMinor: number
  direction: Direction
  categoryId: string | null
  transactionType: TransactionType
  reviewStatus: string
}

export type StatementDetail =
  | { statement: StatementSummary; reviewing: true; rows: ReviewRow[] }
  | { statement: StatementSummary; reviewing: false; rows: SavedRow[] }

export type Category = { id: string; key: string; name: string; isSystem: boolean }
export type BankFormat = { key: string; name: string; status: 'beta' }

export type UploadResult = {
  importId: string
  rowCount: number
  needsReview: number
  duplicates: number
  warnings: string[]
}

export type RowPatch = Partial<{
  categoryId: string | null
  transactionType: TransactionType
  include: boolean
  transactionDate: string
  amountMinor: number
  direction: Direction
  cleanedDescription: string
  duplicateDecision: 'keep_both' | 'exclude'
  reviewed: true
}>

export type Coverage = { hasImports: boolean; statementCount: number; coversWholeMonth: boolean; hasWarnings: boolean }

export type CategorySpend = {
  categoryId: string | null
  name: string
  total: number
  count: number
  share: number
  previousTotal: number | null
  changePercent: number | null
}

export type SpendingSummary = {
  month: string
  moneyIn: number
  moneyOut: number
  netCashFlow: number
  refunds: number
  transfers: number
  unclassifiedIn: number
  transactionCount: number
  categories: CategorySpend[]
  comparison: { month: string; available: boolean; reason: string | null; previousMoneyOut: number | null }
  coverage: Coverage
  trend: { month: string; moneyIn: number; moneyOut: number; coverage: 'full' | 'partial' | 'none' }[]
  recurring: { description: string; typicalAmountMinor: number; months: number; lastDate: string; categoryName: string | null }[]
}

export type Transaction = {
  id: string
  date: string
  description: string
  amountMinor: number
  direction: Direction
  transactionType: TransactionType
  categoryId: string | null
  categoryName: string | null
  excludedFromTotals: boolean
  importId: string
  source: { bankName: string; nickname: string | null } | null
}

export type TransactionDetail = Transaction & {
  note: string | null
  reviewStatus: string
  statement: { periodStart: string; periodEnd: string; importedAt: string | null } | null
}

export type TransactionQuery = {
  month?: string
  q?: string
  categoryId?: string
  type?: TransactionType
  sourceId?: string
  limit?: number
  offset?: number
}

export type TransactionPatch = Partial<{
  categoryId: string | null
  transactionType: TransactionType
  note: string | null
  transactionDate: string
  cleanedDescription: string
  amountMinor: number
  direction: Direction
  excludedFromTotals: boolean
}>

export type Source = { id: string; bankName: string; nickname: string | null }

function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  const text = q.toString()
  return text ? `?${text}` : ''
}

/** Signed-in API calls. Each one sends the access token and refreshes it if needed. */
export function useApi() {
  const { authRequest } = useAuth()

  return useMemo(
    () => ({
      dashboard: (month: string) =>
        authRequest<DashboardSummary>(`/api/dashboard/summary?month=${encodeURIComponent(month)}`),

      spending: (month: string, sourceId?: string, signal?: AbortSignal) =>
        authRequest<SpendingSummary>(`/api/spending/summary${toQuery({ month, sourceId })}`, { signal }),

      transactions: {
        list: (query: TransactionQuery, signal?: AbortSignal) =>
          authRequest<{ transactions: Transaction[]; total: number; offset: number; limit: number }>(
            `/api/transactions${toQuery(query)}`,
            { signal },
          ),
        get: (id: string) => authRequest<{ transaction: TransactionDetail }>(`/api/transactions/${id}`).then((r) => r.transaction),
        update: (id: string, body: TransactionPatch) => authRequest<null>(`/api/transactions/${id}`, { method: 'PATCH', body }),
        remove: (id: string) => authRequest<null>(`/api/transactions/${id}`, { method: 'DELETE' }),
      },

      sources: () => authRequest<{ sources: Source[] }>('/api/sources').then((r) => r.sources),

      categories: () => authRequest<{ categories: Category[] }>('/api/categories').then((r) => r.categories),

      statements: {
        formats: () => authRequest<{ formats: BankFormat[] }>('/api/statements/formats').then((r) => r.formats),
        list: () => authRequest<{ statements: StatementSummary[] }>('/api/statements').then((r) => r.statements),
        get: (id: string) => authRequest<StatementDetail>(`/api/statements/${id}`),
        upload: (form: FormData, signal?: AbortSignal) =>
          authRequest<UploadResult>('/api/statements/upload', { method: 'POST', body: form, signal }),
        update: (id: string, body: { periodStart?: string; periodEnd?: string; nickname?: string | null }) =>
          authRequest<null>(`/api/statements/${id}`, { method: 'PATCH', body }),
        updateRow: (id: string, rowId: string, body: RowPatch) =>
          authRequest<null>(`/api/statements/${id}/rows/${rowId}`, { method: 'PATCH', body }),
        acceptAll: (id: string) => authRequest<null>(`/api/statements/${id}/accept-all`, { method: 'POST' }),
        confirm: (id: string) => authRequest<{ saved: number }>(`/api/statements/${id}/confirm`, { method: 'POST' }),
        cancel: (id: string) => authRequest<null>(`/api/statements/${id}/cancel`, { method: 'POST' }),
        remove: (id: string) => authRequest<null>(`/api/statements/${id}`, { method: 'DELETE' }),
      },
    }),
    [authRequest],
  )
}
