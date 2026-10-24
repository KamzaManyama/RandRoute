import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { BellIcon } from '../components/icons'
import './HomePage.css'

type BackendState =
  | { kind: 'checking' }
  | { kind: 'ok'; ai: 'enabled' | 'disabled' }
  | { kind: 'down'; message: string }

/** Placeholder Home screen. The real dashboard comes in the Core finance UI phase. */
export function HomePage() {
  const [backend, setBackend] = useState<BackendState>({ kind: 'checking' })

  useEffect(() => {
    const controller = new AbortController()
    api
      .health(controller.signal)
      .then((res) => setBackend({ kind: 'ok', ai: res.ai }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setBackend({
          kind: 'down',
          message: error instanceof ApiError ? error.message : 'Backend is not reachable.',
        })
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="home">
      <div className="home__header">
        <div>
          <p className="muted">Welcome to</p>
          <h1>RandRoute</h1>
        </div>
        <button type="button" className="icon-button" aria-label="Notifications">
          <BellIcon />
        </button>
      </div>

      <section className="card card--dark home__hero">
        <div>
          <h2>Import your first statement</h2>
          <p className="home__hero-sub">See where your money goes — no bank login needed.</p>
        </div>
      </section>

      <section className="card" aria-live="polite">
        <h2 className="home__section-title">Setup status</h2>
        {backend.kind === 'checking' && <p className="muted">Checking the backend…</p>}
        {backend.kind === 'ok' && (
          <p>
            Backend connected. AI explanations are <strong>{backend.ai}</strong>.
          </p>
        )}
        {backend.kind === 'down' && <p role="alert">{backend.message}</p>}
      </section>
    </div>
  )
}
