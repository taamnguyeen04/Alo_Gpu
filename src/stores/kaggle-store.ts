// Kaggle state management
import { create } from 'zustand'
import type { KaggleAccount } from '@/lib/kaggle-types'

interface KaggleState {
  // Accounts
  accounts: KaggleAccount[]
  setAccounts: (accounts: KaggleAccount[]) => void

  // The account the Kaggle pages currently display (view selection only —
  // does NOT switch the global ~/.kaggle credentials)
  currentAccountId: string | null
  setCurrentAccountId: (id: string) => void
}

export const useKaggleStore = create<KaggleState>((set) => ({
  // Accounts
  accounts: [],
  setAccounts: (accounts) => set({ accounts }),

  // View selection
  currentAccountId: null,
  setCurrentAccountId: (id) => set({ currentAccountId: id }),
}))
