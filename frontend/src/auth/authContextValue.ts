import { createContext } from 'react'
import type { RequestOptions, SessionUser } from '../lib/api'

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signedOut'; user: null }
  | { status: 'signedIn'; user: SessionUser }

export type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>
  /** Returns true if the user still needs to verify their email. */
  register: (input: { email: string; password: string; displayName?: string; acceptedPolicies: true }) => Promise<boolean>
  logout: () => Promise<void>
  /** Start a session from the refresh token in an email-verification link. */
  startSessionFromLink: (refreshToken: string) => Promise<void>
  /** Token from a password-reset link, kept in memory only. */
  recoveryToken: string | null
  setRecoveryToken: (token: string | null) => void
  resetPassword: (password: string) => Promise<void>
  /** Signed-in API call: adds the access token and retries once after refreshing it. */
  authRequest: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
