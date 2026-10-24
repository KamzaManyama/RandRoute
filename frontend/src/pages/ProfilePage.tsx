import { useAuth } from '../auth/useAuth'
import { PageHeader } from '../components/ui'

const privacyItems = [
  { title: 'Data handling', text: 'RandRoute keeps the cleaned transactions you confirm — never your PDFs or account numbers.', action: 'Review' },
  { title: 'AI consent', text: 'AI explanations are opt-in and can be turned off at any time.', action: 'Manage' },
  { title: 'Export', text: 'Download your transactions and budgets as a file.', action: 'Export' },
  { title: 'Delete account', text: 'Permanently remove your account and all saved financial data.', action: 'Delete', danger: true },
]

/** Screen 16 — Profile and privacy settings (preview). */
export function ProfilePage() {
  const { user } = useAuth()
  return (
    <div className="page">
      <PageHeader eyebrow="Account" title="Profile & privacy" />

      <p className="preview-banner" role="note">
        Editing, export and deletion are coming soon — these buttons don&apos;t do anything yet.
      </p>

      <section className="card">
        <h2 className="section-title">Your details</h2>
        <dl className="detail__facts">
          <dt>Name</dt>
          <dd>{user?.displayName ?? 'Not set'}</dd>
          <dt>Email</dt>
          <dd>{user?.email ?? ''}</dd>
          <dt>Currency</dt>
          <dd>South African rand (ZAR)</dd>
        </dl>
      </section>

      <section className="card">
        <h2 className="section-title">Privacy &amp; data</h2>
        <ul className="list">
          {privacyItems.map((item) => (
            <li key={item.title} className="list-row">
              <span className="list-row__main">
                <span className="list-row__title">{item.title}</span>
                <span className="list-row__meta">{item.text}</span>
              </span>
              <button type="button" className={`button button--small ${item.danger ? 'button--danger' : 'button--ghost'}`} disabled>
                {item.action}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
