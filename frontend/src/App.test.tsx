import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

function mockFetch(response: { ok: boolean; status: number; body: unknown } | 'network-error') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (response === 'network-error') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(response.body), { status: response.status })
  })
}

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('side navigation', () => {
  it('shows the five main destinations plus profile, and no bottom nav', () => {
    mockFetch({ ok: true, status: 200, body: { status: 'ok', ai: 'disabled' } })
    renderAt()
    const nav = screen.getByRole('complementary', { name: 'Main' })
    for (const label of ['Home', 'Statements', 'Spending', 'Budget', 'Insights', 'Profile & privacy']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(document.querySelector('.bottom-nav')).toBeNull()
  })

  it('navigates and marks the current page', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 'ok', ai: 'disabled' } })
    renderAt()
    await userEvent.click(screen.getByRole('link', { name: 'Budget' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens and closes the mobile drawer', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 'ok', ai: 'disabled' } })
    renderAt()
    const open = screen.getByRole('button', { name: 'Open navigation' })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(open).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('home setup status', () => {
  it('shows when the backend is connected', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 'ok', ai: 'disabled' } })
    renderAt()
    expect(await screen.findByText(/Backend connected/)).toBeInTheDocument()
  })

  it('shows a friendly message when the backend is down', async () => {
    mockFetch('network-error')
    renderAt()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cannot reach RandRoute/)
  })
})
