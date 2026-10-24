import { Link } from 'react-router-dom'
import { LegalLayout } from './LegalLayout'

/** Privacy Policy — written to match what RandRoute actually does (POPIA, South Africa). */
export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy policy"
      summary={
        <ul>
          <li>We never ask for your online-banking login, PIN or card details.</li>
          <li>Your statement PDFs are read in memory and thrown away — never stored.</li>
          <li>We keep only the cleaned transactions you confirm, so we can show your spending.</li>
          <li>AI is optional, only runs when you press a button, and only sees category totals.</li>
          <li>You can export or delete everything yourself in Profile &amp; privacy.</li>
        </ul>
      }
    >
      <section>
        <h2>1. Who we are</h2>
        <p>
          RandRoute is a personal-finance web app for people in South Africa. It turns the bank statement PDFs you upload
          into a picture of your spending and budgets. It is not a bank, does not connect to your bank, does not move
          money and does not give financial, investment, credit or tax advice. RandRoute is the responsible party for
          your personal information under the Protection of Personal Information Act, 2013 (POPIA).
        </p>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <table>
          <thead>
            <tr>
              <th>Information</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Email address and password</td>
              <td>To create and secure your account. Passwords are stored only as a secure hash by our sign-in provider — we can&apos;t read them.</td>
            </tr>
            <tr>
              <td>Name (optional)</td>
              <td>Only to greet you in the app.</td>
            </tr>
            <tr>
              <td>Transactions you confirm: date, cleaned description, amount, money in or out, category, type, and any note you add</td>
              <td>To show your spending, budgets and insights.</td>
            </tr>
            <tr>
              <td>Statement details: bank, nickname, statement period, number of rows, and check results (such as opening and closing balance)</td>
              <td>So you can see your imports and know how complete your data is.</td>
            </tr>
            <tr>
              <td>Budgets, spending and savings targets</td>
              <td>To compare your plan with your spending.</td>
            </tr>
            <tr>
              <td>Your choices: setup, AI consent and which policy version you agreed to</td>
              <td>To respect your choices and keep a record of your consent.</td>
            </tr>
            <tr>
              <td>AI usage record: date, type and outcome (never the content)</td>
              <td>To apply the daily AI limit.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>3. What we don&apos;t keep</h2>
        <p>
          Your original PDF statements and the raw text inside them are processed in memory only and discarded as soon as
          processing ends. Before anything is saved, we remove card numbers, account numbers, long reference numbers, phone
          numbers and email addresses from transaction descriptions. We do not store your ID number, address, or the
          account holder name printed on a statement.
        </p>
      </section>

      <section>
        <h2>4. How we use your information</h2>
        <ul>
          <li>To read your statements and show the transactions back to you to check.</li>
          <li>To calculate totals, budgets and insights. These calculations are done by RandRoute itself, not by AI.</li>
          <li>To keep your account secure, for example signing you in and resetting your password.</li>
        </ul>
        <p>We do not sell your information, use it for advertising, or build marketing profiles.</p>
      </section>

      <section>
        <h2>5. Optional AI explanations</h2>
        <p>
          If you switch AI on, pressing a button such as <strong>Explain my spending</strong> sends a short summary to
          Google&apos;s Gemini service: month totals, category totals, changes from last month, budget status and saving
          calculations. It never includes your transaction descriptions, PDFs, account numbers, name or email. Google
          processes that summary under its Gemini API terms; depending on the plan in use, Google may keep it for a
          limited time and may use it to improve its services. You can turn AI off at any time in{' '}
          <Link to="/profile">Profile &amp; privacy</Link>, and RandRoute works fully without it.
        </p>
      </section>

      <section>
        <h2>6. Who we share it with</h2>
        <p>We use a small number of service providers who process information for us:</p>
        <ul>
          <li>
            <strong>Supabase</strong> — database and sign-in. Every record is protected so that only your account can
            reach it.
          </li>
          <li>
            <strong>Google (Gemini)</strong> — only if you use AI explanations, and only the summary described above.
          </li>
          <li>
            <strong>Our hosting provider</strong> — runs the app.
          </li>
        </ul>
        <p>
          Some providers may process information outside South Africa. When they do, we rely on their contractual and
          security commitments to protect it to a standard comparable to POPIA. We share information with authorities
          only where the law requires it.
        </p>
      </section>

      <section>
        <h2>7. How we protect it</h2>
        <p>
          Information travels over encrypted connections. Each person&apos;s records are separated at database level so
          other users can&apos;t reach them. Keys to our services stay on our servers and never in your browser. We keep
          financial details out of our error logs. No system is perfectly secure, but we take care to limit what we keep
          in the first place.
        </p>
      </section>

      <section>
        <h2>8. How long we keep it</h2>
        <p>
          See our <Link to="/data-retention">Data retention policy</Link>. In short: nothing from your PDFs is kept, and
          everything else stays until you delete it or delete your account.
        </p>
      </section>

      <section>
        <h2>9. Your rights</h2>
        <p>Under POPIA you can:</p>
        <ul>
          <li>see what we hold about you — use <strong>Export</strong> in Profile &amp; privacy;</li>
          <li>correct it — edit any transaction, category or detail in the app;</li>
          <li>delete it — delete a transaction, a statement, all your financial data, or your whole account;</li>
          <li>withdraw consent for AI explanations at any time;</li>
          <li>object to how we process your information, and lodge a complaint with the Information Regulator.</li>
        </ul>
      </section>

      <section>
        <h2>10. Children</h2>
        <p>RandRoute is meant for people aged 18 and over.</p>
      </section>

      <section>
        <h2>11. Cookies</h2>
        <p>
          We use one essential cookie to keep you signed in, and nothing for tracking or advertising. See our{' '}
          <Link to="/cookies">Cookie policy</Link>.
        </p>
      </section>

      <section>
        <h2>12. Changes to this policy</h2>
        <p>
          If we change this policy in a way that matters, we&apos;ll update the version and date at the top and let you
          know in the app before the change applies.
        </p>
      </section>
    </LegalLayout>
  )
}
