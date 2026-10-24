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

/** Signed-in API calls. Each one sends the access token and refreshes it if needed. */
export function useApi() {
  const { authRequest } = useAuth()

  return useMemo(
    () => ({
      dashboard: (month: string) =>
        authRequest<DashboardSummary>(`/api/dashboard/summary?month=${encodeURIComponent(month)}`),

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
