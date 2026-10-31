/**
 * The only way the frontend talks to the outside world: the RandRoute backend.
 * No Supabase or Gemini keys live in the browser.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Per-field messages from server-side validation, e.g. { email: "Enter a valid email address." } */
  readonly fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Access token for signed-in requests. */
  token?: string | null
  signal?: AbortSignal
  /** 'blob' for file downloads (e.g. exports). */
  responseType?: 'json' | 'blob'
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Required by the backend's auth routes; blocks cross-site form posts.
    'X-RandRoute-Client': 'web',
  }
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  // FormData sets its own multipart Content-Type (with boundary).
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'include', // sends the httpOnly refresh cookie to /api/auth
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network_error', 'Cannot reach RandRoute right now. Check your connection and try again.')
  }

  if (response.ok && options.responseType === 'blob') return (await response.blob()) as T
  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)
      ?.error
    throw new ApiError(
      response.status,
      err?.code ?? 'http_error',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.fields ?? {},
    )
  }

  return data as T
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------
export type HealthResponse = { status: 'ok'; ai: 'enabled' | 'disabled' }

export type SessionUser = { id: string; email: string | null; displayName: string | null }
export type Session = { accessToken: string; expiresAt: number; user: SessionUser }
export type Profile = SessionUser & { currency: string; setupCompleted: boolean }

export type RegisterResult =
  | { status: 'verification_required'; message: string }
  | { status: 'signed_in'; session: Session }

export type DashboardSummary = {
  month: string
  moneyIn: number
  moneyOut: number
  netCashFlow: number
  refunds: number
  unclassifiedIn: number
  transfers: number
  /** Income split by category, in cents. */
  income: { salary: number; side: number; other: number }
  debitOrders: { total: number; count: number }
  savingsRate: { basisPoints: number | null; percent: number | null }
  health: {
    level: 'healthy' | 'watch' | 'at_risk' | 'not_enough_data'
    provisional: boolean
    reasons: { code: string; tone: 'good' | 'warning' | 'risk' | 'info'; text: string }[]
  }
  goals: {
    expectedIncomeMinor: number | null
    savingsTargetMinor: number | null
    monthlySpendingTargetMinor: number | null
    savingsTargetMet: boolean | null
  }
  budgetTarget: number | null
  budgetRemaining: number | null
  budget: { hasBudget: boolean; overCount: number }
  topCategories: Array<{ categoryId: string | null; name: string; total: number; count: number; sharePercent: number | null }>
  recentTransactions: Array<{
    id: string
    date: string
    description: string
    amountMinor: number
    direction: 'inflow' | 'outflow'
    transactionType: 'income' | 'expense' | 'transfer' | 'refund' | 'unknown'
    channelLabel: string
    categoryName: string | null
  }>
  coverage: {
    hasImports: boolean
    statementCount: number
    coversWholeMonth: boolean
    hasWarnings: boolean
  }
  limitations: string[]
}

export const api = {
  health: (signal?: AbortSignal) => apiRequest<HealthResponse>('/api/health', { signal }),

  auth: {
    register: (body: { email: string; password: string; displayName?: string; acceptedPolicies: true }) =>
      apiRequest<RegisterResult>('/api/auth/register', { method: 'POST', body }),
    login: (body: { email: string; password: string }) =>
      apiRequest<{ session: Session }>('/api/auth/login', { method: 'POST', body }),
    refresh: () => apiRequest<{ session: Session }>('/api/auth/refresh', { method: 'POST' }),
    sessionFromLink: (refreshToken: string) =>
      apiRequest<{ session: Session }>('/api/auth/session', { method: 'POST', body: { refreshToken } }),
    logout: (token: string | null) => apiRequest<null>('/api/auth/logout', { method: 'POST', token }),
    forgotPassword: (email: string) =>
      apiRequest<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: { email } }),
    resendVerification: (email: string) =>
      apiRequest<{ message: string }>('/api/auth/resend-verification', { method: 'POST', body: { email } }),
    resetPassword: (recoveryToken: string, password: string) =>
      apiRequest<{ status: 'password_updated'; session?: Session }>('/api/auth/reset-password', {
        method: 'POST',
        body: { password },
        token: recoveryToken,
      }),
    me: (token: string) => apiRequest<{ user: Profile }>('/api/auth/me', { token }),
  },
}
