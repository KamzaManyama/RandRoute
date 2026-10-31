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
  signal?: AbortSignal
  /** 'blob' for file downloads (e.g. exports). */
  responseType?: 'json' | 'blob'
  /** Send the CSRF token on a GET too (exports need it). */
  csrf?: boolean
}

/*
 * Sessions live in HttpOnly cookies set by the backend: this code never sees
 * an access or refresh token, and never sends an Authorization header.
 *
 * The CSRF token is not a login credential. It proves a request came from
 * this app (another site can't read it), and is kept in memory only.
 */
let csrfToken: string | null = null
let csrfInFlight: Promise<string> | null = null

function loadCsrf(): Promise<string> {
  csrfInFlight ??= send<{ csrfToken: string }>('/api/auth/csrf', {})
    .then((r) => (csrfToken = r.csrfToken))
    .finally(() => {
      csrfInFlight = null
    })
  return csrfInFlight
}

async function send<T>(path: string, options: RequestOptions, csrf?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // The backend rejects API calls without it; other sites can't add it.
    'X-RandRoute-Client': 'web',
  }
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  // FormData sets its own multipart Content-Type (with boundary).
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (csrf) headers['X-CSRF-Token'] = csrf

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'include', // sends the HttpOnly session cookies
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

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const needsCsrf = (options.method ?? 'GET') !== 'GET' || options.csrf === true
  if (!needsCsrf) return send<T>(path, options)
  try {
    return await send<T>(path, options, csrfToken ?? (await loadCsrf()))
  } catch (error) {
    // The CSRF token changes after sign-out; fetch the new one and try once more.
    if (!(error instanceof ApiError) || error.code !== 'csrf_invalid') throw error
    csrfToken = null
    return send<T>(path, options, await loadCsrf())
  }
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------
export type HealthResponse = { status: 'ok'; ai: 'enabled' | 'disabled' }

/** All an auth response carries: no token, user ID or email. */
export type SessionUser = { displayName: string | null }
export type Session = { signedIn: true; user: SessionUser }
export type Profile = SessionUser & { currency: string; setupCompleted: boolean }
export type EmailLinkType = 'signup' | 'email' | 'recovery' | 'email_change' | 'invite' | 'magiclink'
export type VerifyResult = { next: 'reset_password' } | ({ next: 'signed_in'; type: EmailLinkType } & Session)

export type RegisterResult =
  | { status: 'verification_required'; message: string }
  | ({ status: 'signed_in' } & Session)

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
    login: (body: { email: string; password: string }) => apiRequest<Session>('/api/auth/login', { method: 'POST', body }),
    refresh: () => apiRequest<Session>('/api/auth/refresh', { method: 'POST' }),
    /** Email link with a one-time token_hash (no session token in the URL). */
    verify: (tokenHash: string, type: EmailLinkType) =>
      apiRequest<VerifyResult>('/api/auth/verify', { method: 'POST', body: { tokenHash, type } }),
    /** Older email links: hand the token straight to the backend, which sets cookies. */
    sessionFromLink: (refreshToken: string) =>
      apiRequest<Session>('/api/auth/session', { method: 'POST', body: { refreshToken } }),
    recoveryFromLink: (accessToken: string) =>
      apiRequest<{ next: 'reset_password' }>('/api/auth/recovery', { method: 'POST', body: { accessToken } }),
    recoveryStatus: () => apiRequest<{ ready: boolean }>('/api/auth/recovery'),
    logout: () => apiRequest<null>('/api/auth/logout', { method: 'POST' }),
    forgotPassword: (email: string) =>
      apiRequest<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: { email } }),
    resendVerification: (email: string) =>
      apiRequest<{ message: string }>('/api/auth/resend-verification', { method: 'POST', body: { email } }),
    resetPassword: (password: string) =>
      apiRequest<{ status: 'password_updated'; signedIn?: true; user?: SessionUser }>('/api/auth/reset-password', {
        method: 'POST',
        body: { password },
      }),
    me: () => apiRequest<{ user: Profile }>('/api/auth/me'),
  },
}
