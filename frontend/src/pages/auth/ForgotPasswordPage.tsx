import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { FormAlert, SubmitButton, TextField } from '../../components/forms'
import { emailProblem } from '../../lib/validation'
import { AuthLayout } from './AuthLayout'

/** Account recovery: request a password-reset email. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [sentMessage, setSentMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const problem = emailProblem(email)
    setFieldError(problem)
    if (problem) return

    setLoading(true)
    try {
      const res = await api.auth.forgotPassword(email.trim())
      setSentMessage(res.message)
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldError(err.fields.email)
        setError(err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sentMessage ? undefined : "Enter your email and we'll send you a link to choose a new password."}
      footer={
        <Link to="/sign-in" className="auth__link">
          Back to sign in
        </Link>
      }
    >
      {sentMessage ? (
        <FormAlert tone="success">
          <span>{sentMessage}</span>
          <span>The link works once and expires after an hour. Check your spam folder if you can&apos;t see it.</span>
        </FormAlert>
      ) : (
        <form className="auth__form" onSubmit={onSubmit} noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError}
          />
          <SubmitButton loading={loading}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthLayout>
  )
}
