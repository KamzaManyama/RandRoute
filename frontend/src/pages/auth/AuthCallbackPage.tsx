import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { ApiError } from '../../lib/api'
import { FormAlert } from '../../components/forms'
import { AuthLayout } from './AuthLayout'

type Problem = { title: string; message: string; action: 'sign-in' | 'forgot' }

function describeLinkError(params: URLSearchParams): Problem {
  const code = params.get('error_code') ?? params.get('error') ?? ''
  if (code === 'otp_expired') {
    return {
      title: 'This link has expired',
      message: 'Email links work once and expire after a while. Request a new one and try again.',
      action: 'forgot',
    }
  }
  return {
    title: "This link didn't work",
    message: 'It may have been used already. Please sign in, or request a new link.',
    action: 'sign-in',
  }
}

/**
 * Landing page for links in Supabase emails (verify email, reset password).
 * Supabase puts the session in the URL fragment (#access_token=...); we read it,
 * wipe it from the address bar and history, then hand it to the backend.
 */
export function AuthCallbackPage() {
  const { startSessionFromLink, setRecoveryToken } = useAuth()
  const navigate = useNavigate()
  // Read the link once, on first render (before the address bar is cleaned).
  const [link] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    let linkProblem: Problem | null = null
    if (params.get('error') || params.get('error_code')) linkProblem = describeLinkError(params)
    else if (!refreshToken && !(params.get('type') === 'recovery' && accessToken)) {
      linkProblem = { title: "This link didn't work", message: 'The link is incomplete. Please sign in.', action: 'sign-in' }
    }
    return { type: params.get('type'), accessToken, refreshToken, linkProblem }
  })
  const [sessionProblem, setSessionProblem] = useState<Problem | null>(null)
  const problem = link.linkProblem ?? sessionProblem
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    // Remove tokens from the address bar so they don't stay in history.
    window.history.replaceState(null, '', window.location.pathname)
    if (link.linkProblem) return

    if (link.type === 'recovery' && link.accessToken) {
      setRecoveryToken(link.accessToken)
      navigate('/reset-password', { replace: true })
      return
    }

    if (link.refreshToken) {
      startSessionFromLink(link.refreshToken)
        .then(() => navigate('/', { replace: true, state: { notice: 'Your email is verified. Welcome to RandRoute!' } }))
        .catch((err: unknown) =>
          setSessionProblem({
            title: "This link didn't work",
            message: err instanceof ApiError ? err.message : 'Please sign in.',
            action: 'sign-in',
          }),
        )
    }
  }, [link, navigate, setRecoveryToken, startSessionFromLink])

  if (!problem) {
    return (
      <AuthLayout title="Just a moment…">
        <p className="muted" role="status">
          Checking your link.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={problem.title}>
      <FormAlert>{problem.message}</FormAlert>
      {problem.action === 'forgot' ? (
        <Link to="/forgot-password" className="button button--block">
          Send a new link
        </Link>
      ) : (
        <Link to="/sign-in" className="button button--block">
          Go to sign in
        </Link>
      )}
    </AuthLayout>
  )
}
