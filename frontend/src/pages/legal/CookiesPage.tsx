import { LegalLayout } from './LegalLayout'

/** Cookie Policy — RandRoute uses one essential cookie and nothing else. */
export function CookiesPage() {
  return (
    <LegalLayout
      title="Cookie policy"
      summary={
        <ul>
          <li>We use one cookie, and only to keep you signed in.</li>
          <li>No analytics, advertising or tracking cookies.</li>
          <li>Because the cookie is essential, there&apos;s nothing to switch on or off.</li>
        </ul>
      }
    >
      <section>
        <h2>The cookie we use</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose</th>
              <th>Type</th>
              <th>Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>rr_refresh</code>
              </td>
              <td>
                Keeps you signed in between visits. It can&apos;t be read by scripts on the page and is only sent to our
                sign-in service.
              </td>
              <td>Essential (first-party)</td>
              <td>Up to 30 days, or until you sign out</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Other storage in your browser</h2>
        <p>
          RandRoute doesn&apos;t use local storage or session storage to keep personal information. Your short-lived
          access key is held in the page&apos;s memory and disappears when you close the tab.
        </p>
      </section>

      <section>
        <h2>Third parties</h2>
        <p>
          Our font (Urbanist) is loaded from Google Fonts, so your browser contacts Google&apos;s servers to download it,
          as with most websites. We don&apos;t place Google cookies for this, and no advertising or analytics services are
          used.
        </p>
      </section>

      <section>
        <h2>Managing cookies</h2>
        <p>
          You can delete or block cookies in your browser settings. If you block the <code>rr_refresh</code> cookie,
          RandRoute still works but you&apos;ll need to sign in each time you open it.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          If we ever want to add a non-essential cookie, we&apos;ll update this policy and ask for your permission first.
        </p>
      </section>
    </LegalLayout>
  )
}
