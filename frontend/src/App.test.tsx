import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiError, fakeBackend, signedInRoutes, signedOutRoutes, TEST_CSRF, testSession } from './test/fakeBackend'
import { renderApp } from './test/renderApp'

describe('signed out', () => {
  it('sends visitors to the Welcome screen', async () => {
    fakeBackend(signedOutRoutes)
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Welcome to RandRoute' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument()
  })

  it('signs in and lands on Home with the user greeted', async () => {
    const { calls } = fakeBackend({
      ...signedOutRoutes,
      'POST /api/auth/login': () => testSession,
      'GET /api/dashboard/summary': signedInRoutes['GET /api/dashboard/summary']!,
    })
    renderApp('/sign-in')
    await userEvent.type(await screen.findByLabelText('Email'), 'maredi@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rd!')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Maredi' })).toBeInTheDocument()
    const login = calls.find((c) => c.path === '/api/auth/login')!
    expect(login.body).toEqual({ email: 'maredi@example.com', password: 'Passw0rd!' })
    expect(login.headers.get('X-RandRoute-Client')).toBe('web')
    // Writes carry the CSRF token; no call ever carries a bearer token (the session is an HttpOnly cookie).
    expect(login.headers.get('X-CSRF-Token')).toBe(TEST_CSRF)
    expect(calls.every((c) => !c.headers.has('Authorization'))).toBe(true)
    const dashboard = calls.find((c) => c.path === '/api/dashboard/summary')!
    expect(dashboard.headers.get('X-CSRF-Token')).toBeNull() // reads don't need it
    // Nothing about the session is kept in browser storage.
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('shows the server message for a wrong password', async () => {
    fakeBackend({
      ...signedOutRoutes,
      'POST /api/auth/login': () => apiError(401, 'invalid_credentials', 'Incorrect email or password.'),
    })
    renderApp('/sign-in')
    await userEvent.type(await screen.findByLabelText('Email'), 'maredi@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
  })

  it('checks the register form before sending it', async () => {
    const { calls } = fakeBackend(signedOutRoutes)
    renderApp('/register')
    await userEvent.type(await screen.findByLabelText('Email'), 'maredi@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rd1')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Different1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/auth/register')).toBe(false)
  })

  it('tells new users to check their email after registering', async () => {
    fakeBackend({
      ...signedOutRoutes,
      'POST /api/auth/register': () => ({ status: 'verification_required', message: 'Check your inbox.' }),
    })
    renderApp('/register')
    await userEvent.type(await screen.findByLabelText('Email'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Passw0rd1')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Passw0rd1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/confirm you.ve read the privacy, data retention and cookie policies/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText('new@example.com')).toBeInTheDocument()
  })

  it('gives the same answer for forgot password whatever the email', async () => {
    fakeBackend({
      ...signedOutRoutes,
      'POST /api/auth/forgot-password': () => ({ message: "If an account exists for that email, we've sent a link." }),
    })
    renderApp('/forgot-password')
    await userEvent.type(await screen.findByLabelText('Email'), 'anyone@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument()
  })
})

describe('site address and 404', () => {
  it('shows Welcome right at "/" for signed-out visitors', async () => {
    fakeBackend(signedOutRoutes)
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Welcome to RandRoute' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register')
  })

  it('sends old /welcome links to "/"', async () => {
    fakeBackend(signedOutRoutes)
    renderApp('/welcome')
    expect(await screen.findByRole('heading', { name: 'Welcome to RandRoute' })).toBeInTheDocument()
  })

  it('shows the custom 404 page for unknown addresses when signed out', async () => {
    fakeBackend(signedOutRoutes)
    renderApp('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('/no-such-page')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the welcome page' })).toHaveAttribute('href', '/')
  })

  it('shows the custom 404 page when signed in, with links back into the app', async () => {
    fakeBackend(signedInRoutes)
    renderApp('/statments-typo')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/')
  })
})

describe('policies', () => {
  it('sign-in screens link to all three policies', async () => {
    fakeBackend(signedOutRoutes)
    renderApp('/sign-in')
    const nav = await screen.findByRole('navigation', { name: 'Policies' })
    expect(within(nav).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy')
    expect(within(nav).getByRole('link', { name: 'Data retention' })).toHaveAttribute('href', '/data-retention')
    expect(within(nav).getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/cookies')
    expect(screen.queryByText(/google|facebook/i)).not.toBeInTheDocument()
  })

  it.each([
    ['/privacy', 'Privacy policy', /never stored/],
    ['/data-retention', 'Data retention policy', /Statement PDFs are never stored/],
    ['/cookies', 'Cookie policy', /rr_refresh/],
  ])('%s opens without signing in', async (path, heading, text) => {
    fakeBackend(signedOutRoutes)
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getAllByText(text).length).toBeGreaterThan(0)
  })
})

describe('side navigation', () => {
  it('shows the five destinations plus profile, and no bottom nav', async () => {
    fakeBackend(signedInRoutes)
    renderApp('/')
    const nav = await screen.findByRole('complementary', { name: 'Main' })
    for (const label of ['Home', 'Statements', 'Spending', 'Budget', 'Insights']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: /profile/i })).toBeInTheDocument()
    expect(document.querySelector('.bottom-nav')).toBeNull()
  })

  it('opens and closes the mobile drawer', async () => {
    fakeBackend(signedInRoutes)
    renderApp('/')
    const open = await screen.findByRole('button', { name: 'Open navigation' })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(open).toHaveAttribute('aria-expanded', 'false')
  })

  it('signs out and returns to Welcome', async () => {
    const { calls } = fakeBackend(signedInRoutes)
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: /log out|sign out/i }))
    expect(await screen.findByRole('heading', { name: 'Welcome to RandRoute' })).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/auth/logout')).toBe(true)
  })
})

describe('home', () => {
  it('invites a new user to import a statement and says totals are not a live balance', async () => {
    fakeBackend(signedInRoutes)
    renderApp('/')
    expect(await screen.findByRole('link', { name: 'Upload a statement' })).toHaveAttribute('href', '/statements/upload')
    expect(screen.getByText(/not a live bank balance/i)).toBeInTheDocument()
  })
})

describe('email links (no tokens kept in the browser)', () => {
  it('verifies a token_hash link through the backend and wipes it from the address bar', async () => {
    window.history.replaceState(null, '', '/auth/callback?token_hash=abcdef0123456789&type=signup')
    const { calls } = fakeBackend({
      ...signedOutRoutes,
      'POST /api/auth/verify': () => ({ next: 'signed_in', type: 'signup', ...testSession }),
      'GET /api/dashboard/summary': signedInRoutes['GET /api/dashboard/summary']!,
      'GET /api/profile': signedInRoutes['GET /api/profile']!,
    })
    renderApp('/auth/callback')
    expect(await screen.findByText('Your email is verified. Welcome to RandRoute!')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/auth/verify')!.body).toEqual({ tokenHash: 'abcdef0123456789', type: 'signup' })
    expect(window.location.search).toBe('')
  })

  it('sends an older recovery link token to the backend and opens the reset form', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=recovery-token&type=recovery')
    const { calls } = fakeBackend({
      ...signedOutRoutes,
      'POST /api/auth/recovery': () => ({ next: 'reset_password' }),
    })
    renderApp('/auth/callback')
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/auth/recovery')!.body).toEqual({ accessToken: 'recovery-token' })
    expect(window.location.hash).toBe('')
  })
})
