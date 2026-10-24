import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  BudgetIcon,
  CloseIcon,
  HomeIcon,
  InsightsIcon,
  MenuIcon,
  ProfileIcon,
  SpendingIcon,
  StatementsIcon,
} from './icons'
import './AppLayout.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/statements', label: 'Statements', Icon: StatementsIcon, end: false },
  { to: '/spending', label: 'Spending', Icon: SpendingIcon, end: false },
  { to: '/budget', label: 'Budget', Icon: BudgetIcon, end: false },
  { to: '/insights', label: 'Insights', Icon: InsightsIcon, end: false },
] as const

/**
 * Side navigation on every screen size (no bottom nav):
 * persistent sidebar on desktop, slide-out drawer on mobile.
 */
export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeDrawer = () => setDrawerOpen(false)
  const navigate = useNavigate()
  const { logout } = useAuth()

  // Close the drawer with Escape.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const handleLogout = async () => {
    await logout()
    navigate('/', { replace: true })
  }

  return (
    <div className="layout" data-drawer-open={drawerOpen}>
      <header className="topbar">
        <button
          type="button"
          className="icon-button"
          aria-label="Open navigation"
          aria-controls="side-nav"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <MenuIcon />
        </button>
        <span className="brand">RandRoute</span>
      </header>

      <div className="scrim" hidden={!drawerOpen} onClick={() => setDrawerOpen(false)} />

      <aside id="side-nav" className="sidebar" aria-label="Main">
        <div className="sidebar__head">
          <span className="brand">
            <span className="brand__mark" aria-hidden>R</span>
            RandRoute
          </span>
          <button
            type="button"
            className="icon-button sidebar__close"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <nav>
          <ul className="nav-list">
            {NAV_ITEMS.map(({ to, label, Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className="nav-link" onClick={closeDrawer}>
                  <Icon />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar__foot">
          <NavLink to="/profile" className="nav-link" onClick={closeDrawer}>
            <ProfileIcon />
            <span>Profile</span>
          </NavLink>
          <button type="button" className="nav-link nav-link--button nav-link--logout" onClick={handleLogout}>
            <span aria-hidden="true">↩</span>
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
