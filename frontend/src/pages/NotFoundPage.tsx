import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { AuthLayout } from './auth/AuthLayout'

/** Custom 404 — shown for any address that isn't a RandRoute page. */
export function NotFoundPage() {
  const { status } = useAuth()
  const { pathname } = useLocation()
  const signedIn = status === 'signedIn'

  return (
    <AuthLayout
      title="Page not found"
      subtitle={
        <>
          We couldn&apos;t find <code className="not-found__path">{pathname}</code>.
        </>
      }
      hero={{ headline: '404', text: 'This page took a wrong turn. Let’s get you back on route.' }}
    >
      <p className="muted">The link may be old or mistyped. Here are some places to go instead:</p>
      <div className="welcome__actions">
        <Link to="/" className="button button--block">
          {signedIn ? 'Go to Home' : 'Go to the welcome page'}
        </Link>
        {signedIn ? (
          <>
            <Link to="/statements" className="button button--ghost button--block">
              Statements
            </Link>
            <Link to="/spending" className="button button--ghost button--block">
              Spending
            </Link>
          </>
        ) : (
          <Link to="/sign-in" className="button button--ghost button--block">
            Sign in
          </Link>
        )}
      </div>
    </AuthLayout>
  )
}
