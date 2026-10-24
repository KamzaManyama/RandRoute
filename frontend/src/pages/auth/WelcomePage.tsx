import { Link } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'

/** Screen 01 — Welcome */
export function WelcomePage() {
  return (
    <AuthLayout
      title="Welcome to RandRoute"
      subtitle="Understand your money in three steps."
      hero={{
        headline: 'See where your money goes.',
        text: 'Personal finance clarity for South Africans — from the bank statements you already have.',
      }}
    >
      <ol className="welcome__steps">
        <li>
          <span className="welcome__step-number">1</span>
          Import a bank statement PDF
        </li>
        <li>
          <span className="welcome__step-number">2</span>
          Check your categorised transactions
        </li>
        <li>
          <span className="welcome__step-number">3</span>
          See your spending and plan a budget
        </li>
      </ol>
      <p className="muted small">
        RandRoute reads the statements you upload — it is not live banking, and your PDFs aren&apos;t kept after
        processing.
      </p>
      <div className="welcome__actions">
        <Link to="/register" className="button button--block">
          Create account
        </Link>
        <Link to="/sign-in" className="button button--ghost button--block">
          Sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
