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
    parser: string
    detectedBank: string | null
    layoutDetected: boolean
    newestFirst: boolean
    rowsSkipped: number
    feeRows: number
    columnTotalsCheck: 'passed' | 'failed' | 'unavailable'
    balanceCheck: 'passed' | 'mismatch' | 'unavailable'
    totalsCheck: 'passed' | 'failed' | 'unavailable'
    mismatchedRows: number
    openingBalanceMinor: number | null
    closingBalanceMinor: number | null
    periodSource: 'user' | 'statement' | 'transactions'
    rowCount: number
  }
}

export type RowFlag = { code: string; label: string; blocking: boolean }

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
  channel: string
  channelLabel: string
  flags: RowFlag[]
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
  channel?: string
  channelLabel?: string
}

export type StatementDetail =
  | { statement: StatementSummary; reviewing: true; rows: ReviewRow[] }
  | { statement: StatementSummary; reviewing: false; rows: SavedRow[] }

export type Category = { id: string; key: string; name: string; isSystem: boolean }
export type BankFormat = { key: string; name: string; status: 'beta'; support: 'layout_rules' | 'generic'; notes: string | null }

export type UploadResult = {
  importId: string
  rowCount: number
  bankName: string
  period: { start: string; end: string }
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
  channel: string
  channelLabel: string
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

export type LimitStatus = 'on_track' | 'near_limit' | 'reached' | 'exceeded'

export type BudgetView = {
  month: string
  budget: { id: string; expectedIncomeMinor: number | null; savingsTargetMinor: number | null } | null
  limits: { categoryId: string; name: string; limitMinor: number; spentMinor: number; remainingMinor: number; status: LimitStatus }[]
  unbudgeted: { categoryId: string | null; name: string; spentMinor: number }[]
  totals: { plannedMinor: number; spentInBudgetMinor: number; remainingMinor: number; totalSpendingMinor: number; refundsMinor: number }
  coverage: Coverage
  previousMonthHasBudget: boolean
  history: { months: number; averages: { categoryId: string; name: string; averageMinor: number }[] }
}

export type BudgetDraft = {
  expectedIncomeMinor: number | null
  savingsTargetMinor: number | null
  limits: { categoryId: string; limitMinor: number }[]
}

export type AiConsent = 'granted' | 'outdated' | 'not_asked' | 'withdrawn'

export type ProfileData = {
  email: string | null
  displayName: string | null
  currency: string
  monthlyBudgetTargetMinor: number | null
  savingsTargetMinor: number | null
  expectedMonthlyIncomeMinor: number | null
  setupCompleted: boolean
  ai: { available: boolean; consent: AiConsent; consentUpdatedAt: string | null; policyVersion: string }
}

export type HealthLevel = 'healthy' | 'watch' | 'at_risk' | 'not_enough_data'
export type Health = {
  level: HealthLevel
  provisional: boolean
  reasons: { code: string; tone: 'good' | 'warning' | 'risk' | 'info'; text: string }[]
}
export type SavingsRate = { basisPoints: number | null; percent: number | null }
export type Goals = {
  expectedIncomeMinor: number | null
  savingsTargetMinor: number | null
  monthlySpendingTargetMinor: number | null
  savingsTargetMet: boolean | null
}

export type Insights = {
  month: string
  coverage: Coverage
  totals: {
    moneyInMinor: number
    moneyOutMinor: number
    netMinor: number
    refundsMinor: number
    unclassifiedInMinor: number
    previousMoneyOutMinor: number | null
    moneyOutChangePercent: number | null
    income: { salary: number; side: number; other: number }
    debitOrders: { total: number; count: number }
    transfersMinor: number
  }
  savingsRate: SavingsRate
  health: Health
  goals: Goals
  comparison: { month: string; available: boolean; reason: string | null }
  topCategories: { categoryId: string | null; name: string; totalMinor: number; count: number; sharePercent: number | null }[]
  changes: { categoryId: string | null; name: string; totalMinor: number; previousMinor: number; changeMinor: number; changePercent: number | null }[]
  unusual: { categoryId: string | null; name: string; totalMinor: number; averageMinor: number; months: number }[]
  unusualCheck: { available: boolean; historyMonths: number; reason: string | null }
  budget: { hasBudget: boolean; overCount: number; limits: { name: string; limitMinor: number; spentMinor: number; status: LimitStatus }[] }
  limitations: string[]
}

export type AiVerification = { numbersChecked: number; pointsRemoved: number; attempts: number }

export type CoachAnswer = {
  summary: string
  positives: string[]
  concerns: string[]
  actions: string[]
  motivation: string
}

export type CoachResult = {
  coach: CoachAnswer
  verification: AiVerification
  basedOn: Record<string, unknown>
  generatedAt: string
  source: 'ai_generated'
}

export type BudgetReviewResult = {
  review: { summary: string; suggestions: string[] }
  verification: AiVerification
  basedOn: Record<string, unknown>
  generatedAt: string
  source: 'ai_generated'
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

      budgets: {
        get: (month: string) => authRequest<BudgetView>(`/api/budgets/${month}`),
        save: (month: string, draft: BudgetDraft) => authRequest<{ budgetId: string }>(`/api/budgets/${month}`, { method: 'PUT', body: draft }),
        copyPrevious: (month: string) => authRequest<{ copied: number }>(`/api/budgets/${month}/copy-previous`, { method: 'POST' }),
        remove: (month: string) => authRequest<null>(`/api/budgets/${month}`, { method: 'DELETE' }),
      },

      profile: {
        get: () => authRequest<{ profile: ProfileData }>('/api/profile').then((r) => r.profile),
        update: (
          patch: Partial<{
            displayName: string | null
            monthlyBudgetTargetMinor: number | null
            savingsTargetMinor: number | null
            expectedMonthlyIncomeMinor: number | null
            setupCompleted: true
          }>,
        ) =>
          authRequest<{ profile: ProfileData }>('/api/profile', { method: 'PATCH', body: patch }).then((r) => r.profile),
        setAiConsent: (granted: boolean) =>
          authRequest<{ profile: ProfileData }>('/api/profile/ai-consent', { method: 'POST', body: { granted } }).then((r) => r.profile),
        export: (format: 'csv' | 'json') => authRequest<Blob>(`/api/profile/export?format=${format}`, { responseType: 'blob' }),
        deleteData: () => authRequest<null>('/api/profile/delete-data', { method: 'POST', body: { confirm: 'DELETE' } }),
        deleteAccount: (password: string) =>
          authRequest<null>('/api/profile/delete-account', { method: 'POST', body: { confirm: 'DELETE', password } }),
      },

      insights: {
        get: (month: string) => authRequest<{ insights: Insights; ai: { available: boolean } }>(`/api/insights?month=${month}`),
        coachPreview: (month: string) =>
          authRequest<{ input: Record<string, unknown>; ai: { available: boolean } }>(`/api/coach/preview?month=${month}`),
        coach: (month: string) => authRequest<CoachResult>('/api/coach', { method: 'POST', body: { month } }),
        budgetSuggestions: (
          month: string,
          plan: { expectedIncomeMinor: number | null; savingsTargetMinor: number | null; limits: { name: string; limitMinor: number; averageMinor: number | null }[] },
        ) => authRequest<BudgetReviewResult>('/api/budget-suggestions', { method: 'POST', body: { month, plan } }),
      },

      categories: () => authRequest<{ categories: Category[] }>('/api/categories').then((r) => r.categories),

      statements: {
        formats: () => authRequest<{ formats: BankFormat[] }>('/api/statements/formats').then((r) => r.formats),
        list: () => authRequest<{ statements: StatementSummary[] }>('/api/statements').then((r) => r.statements),
        get: (id: string) => authRequest<StatementDetail>(`/api/statements/${id}`),
        upload: (form: FormData, signal?: AbortSignal) =>
          authRequest<UploadResult>('/api/statements/upload', { method: 'POST', body: form, signal }),
        update: (id: string, body: { periodStart?: string; periodEnd?: string; nickname?: string | null; bankFormat?: string }) =>
          authRequest<null>(`/api/statements/${id}`, { method: 'PATCH', body }),
        updateRow: (id: string, rowId: string, body: RowPatch) =>
          authRequest<null>(`/api/statements/${id}/rows/${rowId}`, { method: 'PATCH', body }),
        acceptAll: (id: string) => authRequest<{ accepted: number }>(`/api/statements/${id}/accept-all`, { method: 'POST' }),
        confirm: (id: string, acknowledgeWarnings = false) =>
          authRequest<{ saved: number }>(`/api/statements/${id}/confirm`, { method: 'POST', body: { acknowledgeWarnings } }),
        cancel: (id: string) => authRequest<null>(`/api/statements/${id}/cancel`, { method: 'POST' }),
        remove: (id: string) => authRequest<null>(`/api/statements/${id}`, { method: 'DELETE' }),
      },
    }),
    [authRequest],
  )
}
