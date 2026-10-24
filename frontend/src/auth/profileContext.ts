import { createContext, useContext } from 'react'
import type { ProfileData } from '../lib/useApi'

export type ProfileContextValue = {
  profile: ProfileData | null
  setProfile: (profile: ProfileData) => void
  reload: () => Promise<void>
}

export const ProfileContext = createContext<ProfileContextValue | null>(null)

export function useProfile(): ProfileContextValue {
  const value = useContext(ProfileContext)
  if (!value) throw new Error('useProfile must be used inside <ProfileProvider>')
  return value
}
