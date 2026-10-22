// Modal state management
import { create } from 'zustand'
import type { Profile, WorkspaceState } from '@/lib/modal-types'

interface ModalState {
  // Profiles
  profiles: Profile[]
  currentProfile: string | null
  setProfiles: (profiles: Profile[]) => void
  setCurrentProfile: (name: string) => void

  // Workspaces aggregated state
  workspaces: WorkspaceState[]
  setWorkspaces: (workspaces: WorkspaceState[]) => void

  // Loading states
  isLoadingProfiles: boolean
  setIsLoadingProfiles: (loading: boolean) => void

  // Settings
  concurrency: number
  setConcurrency: (n: number) => void
}

export const useModalStore = create<ModalState>((set) => ({
  // Profiles
  profiles: [],
  currentProfile: null,
  setProfiles: (profiles) => set({ profiles }),
  setCurrentProfile: (name) => set({ currentProfile: name }),

  // Workspaces
  workspaces: [],
  setWorkspaces: (workspaces) => set({ workspaces }),

  // Loading
  isLoadingProfiles: false,
  setIsLoadingProfiles: (loading) => set({ isLoadingProfiles: loading }),

  // Settings
  concurrency: 3,
  setConcurrency: (n) => set({ concurrency: n }),
}))
