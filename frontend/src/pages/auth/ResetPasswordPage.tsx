import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { ApiError } from '../../lib/api'
import { FormAlert, PasswordField, SubmitButton } from '../../components/forms'
import { PASSWORD_HINT, passwordProblem } from '../../lib/validation'
import { AuthLayout } from './AuthLayout'

/** Choose a new password after opening the link in a reset email. */
export function ResetPasswordPage() {
  const { recoveryToken, resetPassword } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)

  if (!recoveryToken) {
    return (
      <AuthLayout
        title="Open your reset link"
        subtitle="For your security, open the link from your password-reset email to choose a new password."
        footer={
          <Link to="/sign-in" className="auth__link">
            Back to sign in
          </Link>
        }
      >
        <Link to="/forgot-password" className="button button--block">
          Send a new reset link
        </Link>
      </AuthLayout>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const errors: Record<string, string> = {}
    const pwError = passwordProblem(password)
    if (pwError) errors.password = pwError
    if (!pwError && confirm !== password) errors.confirm = "Passwords don't match."
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    setLoading(true)
    try {
      await resetPassword(password)
      navigate('/', { replace: true, state: { notice: 'Your password has been changed.' } })
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Something went wrong.')
      setFieldErrors(apiError.fields)
      setError(apiError)
    } finally {
      setLoading(false)
    }
  }

  const linkExpired = error?.code === 'reset_link_invalid'

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be signed in once it's saved. Other devices will be signed out.">
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        {error && (
          <FormAlert>
            <span>{error.message}</span>
            {linkExpired && (
              <span>
                <Link to="/forgot-password" className="auth__link">
                  Send a new reset link
                </Link>
              </span>
            )}
          </FormAlert>
        )}
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint={PASSWORD_HINT}
        />
        <PasswordField
          label="Confirm new password"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldErrors.confirm}
        />
        <SubmitButton loading={loading}>Save new password</SubmitButton>
      </form>
    </AuthLayout>
  )
}
