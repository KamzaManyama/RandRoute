import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { api, ApiError } from '../../lib/api'
import { FormAlert, PasswordField, SubmitButton, TextField } from '../../components/forms'
import { emailProblem } from '../../lib/validation'
import { AuthLayout } from './AuthLayout'

/** Screen 02 — Sign in */
export function SignInPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    const errors: Record<string, string> = {}
    const emailError = emailProblem(email)
    if (emailError) errors.email = emailError
    if (!password) errors.password = 'Enter your password.'
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Something went wrong.')
      setFieldErrors(apiError.fields)
      setError(apiError)
    } finally {
      setLoading(false)
    }
  }

  async function resendVerification() {
    setNotice(null)
    try {
      const res = await api.auth.resendVerification(email.trim())
      setError(null)
      setNotice(res.message)
    } catch (err) {
      setError(err instanceof ApiError ? err : null)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your RandRoute account."
      footer={
        <>
          New to RandRoute?{' '}
          <Link to="/register" className="auth__link">
            Create an account
          </Link>
        </>
      }
    >
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        {error && (
          <FormAlert>
            <span>{error.message}</span>
            {error.code === 'email_not_confirmed' && (
              <span>
                <button type="button" className="link-button" onClick={resendVerification}>
                  Send a new verification email
                </button>
              </span>
            )}
          </FormAlert>
        )}
        {notice && <FormAlert tone="success">{notice}</FormAlert>}

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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />
        <div className="auth__row">
          <Link to="/forgot-password" className="auth__link">
            Forgot password?
          </Link>
        </div>
        <SubmitButton loading={loading}>Sign in</SubmitButton>
      </form>
    </AuthLayout>
  )
}
