import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShieldIcon } from '../../components/icons'
import './auth.css'

type Hero = { headline: ReactNode; text: ReactNode }

type Props = {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Big message on the brand panel. Each screen can set its own. */
  hero?: Hero
}

const DEFAULT_HERO: Hero = {
  headline: 'Hey, hello!',
  text: 'See where your money goes — from the bank statements you already have.',
}

const POINTS = [
  'No bank login needed — you upload a PDF statement',
  'Every row is checked against your running balance',
  'Your PDFs are never stored',
]

/**
 * Split screen used by every sign-in related page (see loginDesign.jpg):
 * brand panel on the left, a white card with the form on the right.
 * On phones the brand panel becomes a short banner above the card.
 */
export function AuthLayout({ title, subtitle, children, footer, hero = DEFAULT_HERO }: Props) {
  return (
    <div className="auth">
      <aside className="auth__panel">
        <Link to="/" className="brand auth__brand">
          <span className="brand__mark auth__mark" aria-hidden>R</span>
          RandRoute
        </Link>
        <div className="auth__hero">
          <p className="auth__headline">{hero.headline}</p>
          <p className="auth__hero-text">{hero.text}</p>
          <ul className="auth__points">
            {POINTS.map((p) => (
              <li key={p}>
                <ShieldIcon width={18} height={18} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="auth__panel-foot">Personal finance clarity for South Africans.</p>
      </aside>

      <div className="auth__side">
        <main className="auth__card">
          <h1 className="auth__title">{title}</h1>
          {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          {children}
          {footer && <div className="auth__footer">{footer}</div>}
        </main>
        <nav className="legal-links" aria-label="Policies">
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/data-retention">Data retention</Link>
          <Link to="/cookies">Cookies</Link>
        </nav>
      </div>
    </div>
  )
}
