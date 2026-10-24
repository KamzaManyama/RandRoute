import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './auth.css'

type Props = {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

/** Centered card used by every sign-in related screen. */
export function AuthLayout({ title, subtitle, children, footer }: Props) {
  return (
    <div className="auth">
      <div className="auth__column">
        <Link to="/welcome" className="brand auth__brand">
          <span className="brand__mark" aria-hidden>R</span>
          RandRoute
        </Link>
        <main className="auth__card">
          <h1 className="auth__title">{title}</h1>
          {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          {children}
        </main>
        {footer && <div className="auth__footer">{footer}</div>}
      </div>
    </div>
  )
}
