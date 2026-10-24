import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { LEGAL } from './legalInfo'
import './legal.css'

/** Shared layout for the Privacy, Data Retention and Cookie policies. Open to everyone. */
export function LegalLayout({ title, summary, children }: { title: string; summary: ReactNode; children: ReactNode }) {
  const { status } = useAuth()
  return (
    <div className="legal">
      <header className="legal__top">
        <Link to={status === 'signedIn' ? '/' : '/welcome'} className="brand">
          <span className="brand__mark" aria-hidden>R</span>
          RandRoute
        </Link>
        <Link to={status === 'signedIn' ? '/profile' : '/sign-in'} className="button button--ghost button--small">
          {status === 'signedIn' ? 'Back to the app' : 'Sign in'}
        </Link>
      </header>

      <nav className="legal__tabs" aria-label="Policies">
        <NavLink to="/privacy">Privacy policy</NavLink>
        <NavLink to="/data-retention">Data retention</NavLink>
        <NavLink to="/cookies">Cookies</NavLink>
      </nav>

      <main className="legal__card">
        <p className="legal__meta">
          Effective {LEGAL.effectiveDate} · Version {LEGAL.version}
        </p>
        <h1>{title}</h1>
        <div className="legal__summary">{summary}</div>
        {children}
        <section>
          <h2>Contact us</h2>
          {LEGAL.contactEmail ? (
            <p>
              Questions or requests about your information:{' '}
              <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
            </p>
          ) : (
            <p>
              You can export or delete your information yourself at any time in <strong>Profile &amp; privacy</strong>. Our
              privacy contact email will be published here before public launch.
            </p>
          )}
          <p>
            If you&apos;re unhappy with how we handle your information, you may complain to the Information Regulator
            (South Africa):{' '}
            <a href="https://inforegulator.org.za" target="_blank" rel="noreferrer">
              inforegulator.org.za
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  )
}
