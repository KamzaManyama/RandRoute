import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useApi, type ProfileData } from '../lib/useApi'
import { ProfileContext } from './profileContext'

/** Loads the signed-in user's profile once and shares it with every page. */
export function ProfileProvider() {
  const api = useApi()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    try {
      setProfile(await api.profile.get())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [api])

  useEffect(() => {
    let cancelled = false
    api.profile
      .get()
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [api])

  const value = useMemo(() => ({ profile, setProfile, reload }), [profile, reload])

  // If the profile can't load, carry on — pages still work; setup just isn't enforced.
  if (!profile && !failed) {
    return (
      <div className="splash" role="status">
        <span className="brand__mark" aria-hidden>R</span>
        <span className="visually-hidden">Loading your profile…</span>
      </div>
    )
  }
  return (
    <ProfileContext.Provider value={value}>
      <Outlet />
    </ProfileContext.Provider>
  )
}

/** New users see Initial setup (Screen 03) before the rest of the app. */
export function SetupGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const ctx = useContext(ProfileContext)
  if (ctx?.profile && !ctx.profile.setupCompleted && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }
  return children
}
