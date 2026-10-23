// Kaggle API types

export interface KaggleAccount {
  id: string
  label: string
  username: string
  auth_method: 'legacy_key' | 'api_token' | 'oauth'
  source: 'managed' | 'global'
  key_hint: string
  is_active_global: boolean
  created_at: string
}

export interface KaggleActiveGlobal {
  username: string
  source:
    'env_token' | 'access_token' | 'legacy_key' | 'oauth' | 'cli_env' | 'none'
}

export interface KaggleQuota {
  resource: string // 'GPU' | 'TPU'
  used_hours: number
  remaining_hours: number
  total_hours: number
  refresh_at: string
}

// --- Kernels (M2) ---

export interface KaggleKernel {
  ref: string // "owner/slug"
  title: string
  author: string
  last_run_time: string
  total_votes: number
}

export interface KaggleKernelStatus {
  kernel: string
  status: string // "running" | "complete" | "error" | "queued" | ...
  failure_message: string
}

export interface KaggleKernelOutputFile {
  name: string
  size: string
  creation_date: string
}

export interface KaggleKernelPushConfig {
  title: string
  slug: string
  language: 'python' | 'r'
  kernel_type: 'notebook' | 'script'
  accelerator: string // machine_shape: "NvidiaTeslaT4" | "" = default
  is_private: boolean
  enable_internet: boolean
  code_file: string
  dataset_sources: string[]
  kernel_sources: string[]
}

// --- Datasets (M3) ---

export interface KaggleDataset {
  ref: string // "owner/slug"
  title: string
  last_updated: string
  total_bytes: number
  download_count: number
  vote_count: number
}

export interface KaggleDatasetFile {
  name: string
  size: string
  creation_date: string
}

// --- AloRun: modal-run style (M4) ---

export interface KaggleProjectScan {
  root: string
  file_count: number
  total_bytes: number
  entrypoints: string[] // project-relative posix .py paths
  requirements: string // 'requirements.txt' or ''
  pyproject: string // 'pyproject.toml' or ''
  over_limit: boolean
  warnings: string[]
}

export interface KaggleRunProjectConfig {
  title: string
  slug: string
  entrypoint: string // relative posix .py (script mode) or '' in module mode
  module: string // package/module name or '' in script mode
  requirements: string // relative path to requirements.txt / pyproject.toml or ''
  extra_packages: string[]
  dataset_sources: string[]
  secrets: string[]
  args: string[]
  output_paths: string[]
  accelerator: string // machine_shape or '' (CPU)
  enable_internet: boolean
  no_run: boolean
}

export interface KaggleRunProjectResult {
  kernel: string // owner/slug
  title: string
  transport: string // "embedded" | "private_dataset:<owner/slug>"
  file_count: number
  source_bytes: number
  runner_bytes: number
  message: string // CLI push output (contains the Kaggle URL)
}
