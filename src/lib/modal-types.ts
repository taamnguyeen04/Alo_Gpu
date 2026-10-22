// Modal API types

export interface Profile {
  name: string
  workspace: string
  is_active: boolean
}

export interface App {
  name: string
  status: string
  created_at: string
}

export interface Volume {
  name: string
  created_at: string
}

export interface FileItem {
  name: string
  type: 'file' | 'directory'
  size: string
  modified: string
  path?: string
}

export interface SystemInfo {
  os: string
  arch: string
  home_dir: string
}

export interface UploadTask {
  localPath: string
  remotePath: string
  status: 'pending' | 'uploading' | 'completed' | 'error'
  progress: number
  error?: string
}

export interface DownloadTask {
  remotePath: string
  localPath: string
  status: 'pending' | 'downloading' | 'completed' | 'error'
  progress: number
  error?: string
}

// Workspace card state
export interface WorkspaceState {
  profile: Profile
  credits?: number
  appsCount: number
  volumesCount: number
  status: 'active' | 'degraded' | 'inactive'
}

// Secret types
export interface Secret {
  name: string
  created_at?: string
}

export interface SecretKeyValue {
  key: string
  value: string
}

// Billing types
export interface BillingSummary {
  adjustments?: { credits?: string }
  billed_cost?: string
  metered_cost?: string
}

export type BillingRates = Record<string, string | number>
