import { createContext } from 'react'
import type { RequestOptions, Session, SessionUser } from '../lib/api'

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signedOut'; user: null }
  | { status: 'signedIn'; user: SessionUser }

export type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>
  /** Returns true if the user still needs to verify their email. */
  register: (input: { email: string; password: string; displayName?: string; acceptedPolicies: true }) => Promise<boolean>
  logout: () => Promise<void>
  /** Older email links: send the link's refresh token to the backend, which sets the session cookies. */
  startSessionFromLink: (refreshToken: string) => Promise<void>
  /** Mark the user signed in after the backend has set session cookies (e.g. a verified email link). */
  applySession: (session: Session | null) => void
  /** True once a password-reset link has been opened (the reset token itself is an HttpOnly cookie). */
  recoveryReady: boolean
  setRecoveryReady: (ready: boolean) => void
  resetPassword: (password: string) => Promise<void>
  /** Signed-in API call: cookies are sent automatically; refreshes once on 401. */
  authRequest: <T>(path: string, options?: RequestOptions) => Promise<T>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
