import { useAuth } from '../auth/useAuth'
import './ProfilePage.css'

export function ProfilePage() {
  const { user } = useAuth()
  return (
    <div className="profile">
      <header className="profile__header">
        <div>
          <p className="muted">Account</p>
          <h1>Profile & privacy</h1>
        </div>
        <button type="button" className="button button--ghost">
          Edit profile
        </button>
      </header>

      <p className="preview-banner" role="note">
        Editing, export and deletion are coming soon — these buttons don't do anything yet.
      </p>

      <section className="card profile__card">
        <div className="profile__summary">
          <div>
            <p className="muted">Display name</p>
            <h2>{user?.displayName ?? 'Not set'}</h2>
          </div>
          <div>
            <p className="muted">Email</p>
            <h2>{user?.email ?? ''}</h2>
          </div>
          <div>
            <p className="muted">Currency</p>
            <h2>ZAR</h2>
          </div>
        </div>
      </section>

      <section className="card profile__section">
        <h2 className="section-title">Privacy & data</h2>
        <ul className="profile__list">
          <li>
            <div>
              <strong>Data handling</strong>
              <small>RandRoute keeps imported statement records and calculated summaries only.</small>
            </div>
            <button type="button" className="button button--ghost">Review</button>
          </li>
          <li>
            <div>
              <strong>Consent</strong>
              <small>AI assistance remains opt-in and can be turned off at any point.</small>
            </div>
            <button type="button" className="button button--ghost">Manage</button>
          </li>
          <li>
            <div>
              <strong>Export</strong>
              <small>Download your transaction and budget data as a CSV summary.</small>
            </div>
            <button type="button" className="button button--ghost">Export</button>
          </li>
          <li>
            <div>
              <strong>Delete account</strong>
              <small>Permanently remove your account and saved financial data.</small>
            </div>
            <button type="button" className="button button--ghost danger-button">Delete</button>
          </li>
        </ul>
      </section>
    </div>
  )
}
