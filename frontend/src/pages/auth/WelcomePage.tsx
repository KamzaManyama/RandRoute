import { Link } from 'react-router-dom'
import { ShieldIcon } from '../../components/icons'
import './auth.css'

/** Screen 01 — Welcome */
export function WelcomePage() {
  return (
    <div className="auth">
      <div className="auth__column">
        <span className="brand auth__brand">
          <span className="brand__mark" aria-hidden>R</span>
          RandRoute
        </span>

        <section className="card--dark welcome__hero">
          <h1>See where your money goes.</h1>
          <p>Personal finance clarity for South Africans — from the bank statements you already have.</p>
        </section>

        <main className="auth__card">
          <ol className="welcome__steps">
            <li>
              <span className="welcome__step-number">1</span>
              Import a bank statement PDF
            </li>
            <li>
              <span className="welcome__step-number">2</span>
              Review your categorised transactions
            </li>
            <li>
              <span className="welcome__step-number">3</span>
              Understand your spending and plan a budget
            </li>
          </ol>

          <p className="welcome__privacy">
            <ShieldIcon />
            <span>
              No bank login needed. RandRoute reads the statements you upload — it is not live banking, and your PDFs
              aren&apos;t kept after processing.
            </span>
          </p>

          <div className="welcome__actions">
            <Link to="/register" className="button button--block">
              Create account
            </Link>
            <Link to="/sign-in" className="button button--ghost button--block">
              Sign in
            </Link>
          </div>
        </main>
      </div>
    </div>
  )
}
