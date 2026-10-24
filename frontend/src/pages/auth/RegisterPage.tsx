import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { api, ApiError } from '../../lib/api'
import { FormAlert, PasswordField, SubmitButton, TextField } from '../../components/forms'
import { emailProblem, PASSWORD_HINT, passwordProblem } from '../../lib/validation'
import { AuthLayout } from './AuthLayout'

/** Screen 02 — Create account */
export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resendNotice, setResendNotice] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const errors: Record<string, string> = {}
    const emailError = emailProblem(email)
    if (emailError) errors.email = emailError
    const pwError = passwordProblem(password)
    if (pwError) errors.password = pwError
    if (!pwError && confirm !== password) errors.confirm = "Passwords don't match."
    if (displayName.trim().length > 60) errors.displayName = 'Use 60 characters or fewer.'
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    setLoading(true)
    try {
      const needsVerification = await register({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
      })
      if (needsVerification) setSentTo(email.trim())
      else navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields)
        setError(err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function resend() {
    if (!sentTo) return
    try {
      const res = await api.auth.resendVerification(sentTo)
      setResendNotice(res.message)
    } catch (err) {
      setResendNotice(err instanceof ApiError ? err.message : 'Could not send the email. Try again later.')
    }
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a verification link to <strong>{sentTo}</strong>. Open it to finish creating your account.
          </>
        }
        footer={
          <Link to="/sign-in" className="auth__link">
            Back to sign in
          </Link>
        }
      >
        <FormAlert tone="info">
          <span>Didn&apos;t get it? Check your spam folder. The link expires after a while.</span>
          <span>
            <button type="button" className="link-button" onClick={resend}>
              Send it again
            </button>
          </span>
        </FormAlert>
        {resendNotice && <FormAlert tone="success">{resendNotice}</FormAlert>}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It takes a minute. No bank login needed."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="auth__link">
            Sign in
          </Link>
        </>
      }
    >
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        {error && <FormAlert>{error}</FormAlert>}

        <TextField
          label="Your name (optional)"
          name="displayName"
          autoComplete="given-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={fieldErrors.displayName}
          hint="Only used to greet you."
        />
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint={PASSWORD_HINT}
        />
        <PasswordField
          label="Confirm password"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldErrors.confirm}
        />
        <SubmitButton loading={loading}>Create account</SubmitButton>
      </form>
    </AuthLayout>
  )
}
