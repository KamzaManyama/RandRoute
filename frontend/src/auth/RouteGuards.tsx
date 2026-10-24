import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { WelcomePage } from '../pages/auth/WelcomePage'

function LoadingScreen() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <span className="brand__mark" aria-hidden>R</span>
      <span className="visually-hidden">Loading RandRoute…</span>
    </div>
  )
}

/**
 * Only for signed-in users. Signed-out visitors see Welcome right at "/" (the
 * site address); any other app page sends them to "/" and back afterwards.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <LoadingScreen />
  if (status === 'signedOut') {
    if (location.pathname === '/') return <WelcomePage />
    return <Navigate to="/" replace state={{ from: location.pathname }} />
  }
  return children
}

/** Welcome / sign-in / register: signed-in users go straight to the app. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <LoadingScreen />
  if (status === 'signedIn') return <Navigate to="/" replace />
  return children
}
