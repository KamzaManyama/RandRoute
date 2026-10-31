import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, apiRequest, type RequestOptions, type Session } from '../lib/api'
import { AuthContext, type AuthContextValue, type AuthState } from './authContextValue'

// One refresh at a time, even if several callers (or React StrictMode) ask at once.
let refreshInFlight: Promise<Session | null> | null = null
function refreshOnce(): Promise<Session | null> {
  refreshInFlight ??= api.auth
    .refresh()
    .then((res) => res.session)
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
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null)
  // The access token lives in memory only (never localStorage).
  const tokenRef = useRef<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const applySession = useCallback((session: Session | null) => {
    function apply(next: Session | null) {
      clearTimeout(refreshTimer.current)
      if (!next) {
        tokenRef.current = null
        setState({ status: 'signedOut', user: null })
        return
      }
      tokenRef.current = next.accessToken
      setState({ status: 'signedIn', user: next.user })

      // Refresh a minute before the access token expires.
      const msUntilRefresh = Math.max(next.expiresAt * 1000 - Date.now() - 60_000, 5_000)
      refreshTimer.current = setTimeout(() => {
        refreshOnce()
          .then(apply)
          .catch(() => undefined) // offline: try again on the next request
      }, msUntilRefresh)
    }
    apply(session)
  }, [])

  // On first load, restore the session from the httpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false
    refreshOnce()
      .then((session) => !cancelled && applySession(session))
      .catch(() => !cancelled && applySession(null))
    return () => {
      cancelled = true
      clearTimeout(refreshTimer.current)
    }
  }, [applySession])

  const login = useCallback(
    async (email: string, password: string) => {
      const { session } = await api.auth.login({ email, password })
      applySession(session)
    },
    [applySession],
  )

  const register = useCallback(
    async (input: { email: string; password: string; displayName?: string; acceptedPolicies: true }) => {
      const result = await api.auth.register(input)
      if (result.status === 'signed_in') {
        applySession(result.session)
        return false
      }
      return true
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    const token = tokenRef.current
    applySession(null)
    await api.auth.logout(token).catch(() => undefined)
  }, [applySession])

  const startSessionFromLink = useCallback(
    async (refreshToken: string) => {
      const { session } = await api.auth.sessionFromLink(refreshToken)
      applySession(session)
    },
    [applySession],
  )

  const resetPassword = useCallback(
    async (password: string) => {
      if (!recoveryToken) {
        throw new ApiError(401, 'reset_link_invalid', 'Open the link from your password-reset email first.')
      }
      const result = await api.auth.resetPassword(recoveryToken, password)
      setRecoveryToken(null)
      applySession(result.session ?? null)
    },
    [recoveryToken, applySession],
  )

  const authRequest = useCallback(
    async <T,>(path: string, options: Omit<RequestOptions, 'token'> = {}): Promise<T> => {
      try {
        return await apiRequest<T>(path, { ...options, token: tokenRef.current })
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error
        const session = await refreshOnce()
        applySession(session)
        if (!session) throw error
        return apiRequest<T>(path, { ...options, token: session.accessToken })
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
      recoveryToken,
      setRecoveryToken,
      resetPassword,
      authRequest,
    }),
    [state, login, register, logout, startSessionFromLink, recoveryToken, resetPassword, authRequest],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
