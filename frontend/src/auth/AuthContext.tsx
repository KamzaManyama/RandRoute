import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, apiRequest, type RequestOptions, type Session } from '../lib/api'
import { AuthContext, type AuthContextValue, type AuthState } from './authContextValue'

/*
 * The session lives in HttpOnly cookies set by the backend. This code never
 * holds an access or refresh token: it only knows whether you're signed in
 * and your display name (SECURITY.md 5.2).
 */

// One refresh at a time, even if several callers (or React StrictMode) ask at once.
let refreshInFlight: Promise<Session | null> | null = null
function refreshOnce(): Promise<Session | null> {
  refreshInFlight ??= api.auth
    .refresh()
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    })
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })
  const [recoveryReady, setRecoveryReady] = useState(false)

  const applySession = useCallback((session: Session | null) => {
    setState(session ? { status: 'signedIn', user: session.user } : { status: 'signedOut', user: null })
  }, [])

  // On first load, ask the backend whether the session cookie is still valid.
  // Only applies while still loading, so it can't undo a sign-in that finished first (e.g. an email link).
  useEffect(() => {
    let cancelled = false
    const settle = (session: Session | null) =>
      !cancelled &&
      setState((prev) =>
        prev.status !== 'loading' ? prev : session ? { status: 'signedIn', user: session.user } : { status: 'signedOut', user: null },
      )
    refreshOnce()
      .then(settle)
      .catch(() => settle(null))
    return () => {
      cancelled = true
    }
  }, [applySession])

  const login = useCallback(
    async (email: string, password: string) => {
      applySession(await api.auth.login({ email, password }))
    },
    [applySession],
  )

  const register = useCallback(
    async (input: { email: string; password: string; displayName?: string; acceptedPolicies: true }) => {
      const result = await api.auth.register(input)
      if (result.status === 'signed_in') {
        applySession(result)
        return false
      }
      return true
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    applySession(null)
    await api.auth.logout().catch(() => undefined)
  }, [applySession])

  const startSessionFromLink = useCallback(
    async (refreshToken: string) => {
      applySession(await api.auth.sessionFromLink(refreshToken))
    },
    [applySession],
  )

  const resetPassword = useCallback(
    async (password: string) => {
      const result = await api.auth.resetPassword(password)
      setRecoveryReady(false)
      applySession(result.signedIn && result.user ? { signedIn: true, user: result.user } : null)
    },
    [applySession],
  )

  /** Signed-in API call: the cookie goes along automatically; on 401, refresh once and retry. */
  const authRequest = useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      try {
        return await apiRequest<T>(path, options)
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error
        const session = await refreshOnce()
        applySession(session)
        if (!session) throw error
        return apiRequest<T>(path, options)
      }
    },
    [applySession],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      register,
      logout,
      startSessionFromLink,
      applySession,
      recoveryReady,
      setRecoveryReady,
      resetPassword,
      authRequest,
    }),
    [state, login, register, logout, startSessionFromLink, applySession, recoveryReady, resetPassword, authRequest],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
