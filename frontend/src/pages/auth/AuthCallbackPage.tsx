import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { api, ApiError, type EmailLinkType } from '../../lib/api'
import { FormAlert } from '../../components/forms'
import { AuthLayout } from './AuthLayout'

type Problem = { title: string; message: string; action: 'sign-in' | 'forgot' }

const LINK_TYPES: EmailLinkType[] = ['signup', 'email', 'recovery', 'email_change', 'invite', 'magiclink']
const isLinkType = (value: string | null): value is EmailLinkType => LINK_TYPES.includes(value as EmailLinkType)

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

const brokenLink: Problem = { title: "This link didn't work", message: 'The link is incomplete. Please sign in.', action: 'sign-in' }

/**
 * Landing page for links in Supabase emails (verify email, reset password,
 * change email).
 *
 * Preferred: the link carries a one-time `token_hash` in the query string. We
 * send it to the backend, which checks it and sets HttpOnly cookies.
 * Older links put tokens in the URL fragment; those are handed to the backend
 * straight away too. Either way the address bar is wiped first and nothing is
 * kept in the browser.
 */
export function AuthCallbackPage() {
  const { startSessionFromLink, applySession, setRecoveryReady } = useAuth()
  const navigate = useNavigate()
  // Read the link once, on first render (before the address bar is cleaned).
  const [link] = useState(() => {
    const query = new URLSearchParams(window.location.search.slice(1))
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const params = fragment.toString() ? fragment : query
    const tokenHash = query.get('token_hash')
    const linkType = query.get('type')
    const accessToken = fragment.get('access_token')
    const refreshToken = fragment.get('refresh_token')
    // With "secure email change", the first of the two links only carries a message.
    const halfwayEmailChange = !tokenHash && !refreshToken && Boolean(params.get('message')) && !params.get('error')
    let linkProblem: Problem | null = null
    if (params.get('error') || params.get('error_code')) linkProblem = describeLinkError(params)
    else if (tokenHash && !isLinkType(linkType)) linkProblem = brokenLink
    else if (!tokenHash && !halfwayEmailChange && !refreshToken && !(fragment.get('type') === 'recovery' && accessToken)) linkProblem = brokenLink
    return { tokenHash, linkType, type: fragment.get('type'), accessToken, refreshToken, linkProblem, halfwayEmailChange }
  })
  const [sessionProblem, setSessionProblem] = useState<Problem | null>(null)
  const problem = link.linkProblem ?? sessionProblem
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    // Remove codes and tokens from the address bar so they don't stay in history.
    window.history.replaceState(null, '', window.location.pathname)
    if (link.linkProblem || link.halfwayEmailChange) return

    const fail = (err: unknown) =>
      setSessionProblem({
        title: "This link didn't work",
        message: err instanceof ApiError ? err.message : 'Please sign in.',
        action: 'sign-in',
      })
    const signedIn = (type: string | null) =>
      navigate(type === 'email_change' ? '/profile' : '/', {
        replace: true,
        state: { notice: type === 'email_change' ? 'Your sign-in email has been changed.' : 'Your email is verified. Welcome to RandRoute!' },
      })
    const toReset = () => {
      setRecoveryReady(true)
      navigate('/reset-password', { replace: true })
    }

    if (link.tokenHash && isLinkType(link.linkType)) {
      api.auth
        .verify(link.tokenHash, link.linkType)
        .then((result) => {
          if (result.next === 'reset_password') return toReset()
          applySession({ signedIn: true, user: result.user })
          signedIn(result.type)
        })
        .catch(fail)
      return
    }

    if (link.type === 'recovery' && link.accessToken) {
      api.auth.recoveryFromLink(link.accessToken).then(toReset).catch(fail)
      return
    }

    if (link.refreshToken) {
      startSessionFromLink(link.refreshToken)
        .then(() => signedIn(link.type))
        .catch(fail)
    }
  }, [link, navigate, setRecoveryReady, startSessionFromLink, applySession])

  if (link.halfwayEmailChange) {
    return (
      <AuthLayout title="One more step">
        <FormAlert tone="success">
          Confirmed. To finish changing your email, open the link we sent to your other email address too.
        </FormAlert>
        <Link to="/" className="button button--block">
          Continue
        </Link>
      </AuthLayout>
    )
  }

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
