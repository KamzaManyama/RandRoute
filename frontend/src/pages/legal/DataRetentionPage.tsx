import { Link } from 'react-router-dom'
import { LegalLayout } from './LegalLayout'

const ROWS: { what: string; kept: string; removed: string }[] = [
  {
    what: 'Your statement PDF and the raw text inside it',
    kept: 'Not kept. Read in memory while your upload is processed.',
    removed: 'Discarded as soon as processing ends — whether it succeeds, fails or you cancel.',
  },
  {
    what: 'A fingerprint of each uploaded PDF (a one-way SHA-256 code)',
    kept: 'With the statement record, so the same file can’t be imported twice. The PDF can’t be rebuilt from it.',
    removed: 'Deleted with the statement, all your financial data, or your account.',
  },
  {
    what: 'Rows waiting for your review (not yet imported)',
    kept: 'Until you confirm or cancel the import.',
    removed: 'Moved into your transactions when you confirm, or deleted when you cancel. Abandoned imports are cleared after 24 hours.',
  },
  {
    what: 'Saved transactions, categories, notes and statement details',
    kept: 'Until you delete them or your account.',
    removed: 'Delete one transaction, a whole statement, or all your financial data in the app.',
  },
  {
    what: 'Budgets, spending and savings targets',
    kept: 'Until you delete them or your account.',
    removed: 'Remove a month’s budget, or delete all your financial data.',
  },
  {
    what: 'Account details: email, name, preferences, AI consent and policy agreement',
    kept: 'While your account exists.',
    removed: 'Deleted when you delete your account in Profile & privacy.',
  },
  {
    what: 'Sign-in session',
    kept: 'Up to 30 days, or until you sign out.',
    removed: 'Signing out, resetting your password or deleting your account ends it.',
  },
  {
    what: 'AI usage record (date, type and outcome — no content)',
    kept: 'While your account exists.',
    removed: 'Deleted with your account.',
  },
  {
    what: 'What you send to AI and its answer',
    kept: 'Not stored by RandRoute. Shown on screen only.',
    removed: 'Google may keep requests for a limited time under its Gemini API terms.',
  },
  {
    what: 'Exports you download',
    kept: 'Not stored. Created when you ask and sent straight to your device.',
    removed: '—',
  },
]

/** Data Retention Policy — how long each kind of information is kept. */
export function DataRetentionPage() {
  return (
    <LegalLayout
      title="Data retention policy"
      summary={
        <ul>
          <li>We keep as little as possible, for as long as you want us to.</li>
          <li>Statement PDFs are never stored.</li>
          <li>Everything you save stays until you delete it — and you can delete it yourself at any time.</li>
        </ul>
      }
    >
      <section>
        <h2>What we keep and for how long</h2>
        <table>
          <thead>
            <tr>
              <th>Information</th>
              <th>How long</th>
              <th>How it&apos;s removed</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.what}>
                <td>{r.what}</td>
                <td>{r.kept}</td>
                <td>{r.removed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Deleting your information</h2>
        <p>
          In <Link to="/profile">Profile &amp; privacy</Link> you can delete all your financial data (your account stays)
          or delete your account entirely. Deletion takes effect in the app straight away, and totals and budgets update
          immediately.
        </p>
      </section>

      <section>
        <h2>Backups</h2>
        <p>
          Our database provider keeps encrypted backups so we can recover from a failure. Information you delete may stay
          in those backups until they expire on the provider&apos;s normal schedule. Backups are not used for anything else
          and are not restored except to recover the service.
        </p>
      </section>

      <section>
        <h2>Logs</h2>
        <p>
          Our servers record technical errors (for example, which page failed) to keep the service working. These records
          never contain statement contents, transaction details, passwords or AI requests.
        </p>
      </section>
    </LegalLayout>
  )
}
