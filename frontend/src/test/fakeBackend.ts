import { vi } from 'vitest'

export type FakeRequest = { method: string; path: string; query: URLSearchParams; body: unknown; headers: Headers }
type Handler = (req: FakeRequest) => unknown | Response | Promise<unknown | Response>

/**
 * Replaces fetch with a tiny fake backend. Routes look like "GET /api/statements/:id".
 * A handler can return a plain object (sent as 200 JSON), a Response, or throw.
 */
export function fakeBackend(routes: Record<string, Handler>) {
  const calls: FakeRequest[] = []
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ') as [string, string]
    const re = new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '[^/]+')}$`)
    return { method, re, handler }
  })

  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown = init?.body
    if (typeof body === 'string') body = JSON.parse(body)
    const req: FakeRequest = { method, path: url.pathname, query: url.searchParams, body, headers: new Headers(init?.headers) }
    calls.push(req)

    const route = compiled.find((r) => r.method === method && r.re.test(url.pathname))
    if (!route) return json({ error: { code: 'not_found', message: `No fake for ${method} ${url.pathname}` } }, 404)
    const result = await route.handler(req)
    if (result instanceof Response) return result
    if (result === null || result === undefined) return new Response(null, { status: 204 })
    return json(result)
  })

  return { calls, spy }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function apiError(status: number, code: string, message: string, fields?: Record<string, string>) {
  return json({ error: { code, message, ...(fields ? { fields } : {}) } }, status)
}

export const testSession = {
  accessToken: 'test-access-token',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1', email: 'maredi@example.com', displayName: 'Maredi Manyama' },
}

export const emptyDashboard = {
  month: '2026-10',
  moneyIn: 0,
  moneyOut: 0,
  netCashFlow: 0,
  refunds: 0,
  unclassifiedIn: 0,
  budgetTarget: null,
  budgetRemaining: null,
  topCategories: [],
  recentTransactions: [],
  coverage: { hasImports: false, statementCount: 0, coversWholeMonth: false, hasWarnings: false },
}

export const testProfile = {
  email: "maredi@example.com",
  displayName: "Maredi Manyama",
  currency: "ZAR",
  monthlyBudgetTargetMinor: null,
  savingsTargetMinor: null,
  setupCompleted: true,
  ai: { available: true, consent: "not_asked", consentUpdatedAt: null, policyVersion: "2026-10" },
}

/** Routes every signed-in screen needs. */
export const signedInRoutes: Record<string, Handler> = {
  'POST /api/auth/refresh': () => ({ session: testSession }),
  'POST /api/auth/logout': () => null,
  'GET /api/dashboard/summary': () => emptyDashboard,
  'GET /api/health': () => ({ status: 'ok', ai: 'disabled' }),
  'GET /api/profile': () => ({ profile: testProfile }),
}

export const signedOutRoutes: Record<string, Handler> = {
  'POST /api/auth/refresh': () => apiError(401, 'no_session', 'Please sign in.'),
}
