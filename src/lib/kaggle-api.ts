// Kaggle API - wrapper around Tauri invoke
import { invoke } from '@tauri-apps/api/core'
import type {
  KaggleAccount,
  KaggleActiveGlobal,
  KaggleQuota,
  KaggleKernel,
  KaggleKernelStatus,
  KaggleKernelOutputFile,
  KaggleKernelPushConfig,
  KaggleDataset,
  KaggleDatasetFile,
} from './kaggle-types'

// CLI availability
export async function kaggleCliAvailable(): Promise<boolean> {
  return invoke('kaggle_cli_available')
}

// Account commands
export async function listKaggleAccounts(): Promise<KaggleAccount[]> {
  return invoke('kaggle_list_accounts')
}

export async function getKaggleActiveGlobal(): Promise<KaggleActiveGlobal> {
  return invoke('kaggle_get_active_global')
}

export async function addKaggleAccount(
  label: string,
  username: string,
  key: string
): Promise<KaggleAccount> {
  return invoke('kaggle_add_account', { label, username, key })
}

export async function addKaggleTokenAccount(
  label: string,
  token: string
): Promise<KaggleAccount> {
  return invoke('kaggle_add_token_account', { label, token })
}

export async function updateKaggleAccount(
  accountId: string,
  label: string
): Promise<void> {
  return invoke('kaggle_update_account', { accountId, label })
}

export async function removeKaggleAccount(accountId: string): Promise<void> {
  return invoke('kaggle_remove_account', { accountId })
}

export async function setKaggleActiveAccount(
  accountId: string
): Promise<string> {
  return invoke('kaggle_set_active_account', { accountId })
}

// Quota commands
export async function getKaggleQuota(accountId: string): Promise<KaggleQuota[]> {
  return invoke('kaggle_quota', { accountId })
}

// Kernel commands
export async function listKaggleKernels(accountId: string): Promise<KaggleKernel[]> {
  return invoke('kaggle_kernels', { accountId })
}

export async function getKaggleKernelStatus(
  accountId: string,
  kernel: string
): Promise<KaggleKernelStatus> {
  return invoke('kaggle_kernel_status', { accountId, kernel })
}

export async function getKaggleKernelLogs(
  accountId: string,
  kernel: string
): Promise<string> {
  return invoke('kaggle_kernel_logs', { accountId, kernel })
}

export async function listKaggleKernelOutputFiles(
  accountId: string,
  kernel: string
): Promise<KaggleKernelOutputFile[]> {
  return invoke('kaggle_kernel_output_files', { accountId, kernel })
}

export async function pushKaggleKernel(
  accountId: string,
  folder: string,
  config: KaggleKernelPushConfig,
  noRun: boolean
): Promise<string> {
  return invoke('kaggle_kernel_push', { accountId, folder, config, noRun })
}

export async function downloadKaggleKernelOutput(
  accountId: string,
  kernel: string,
  file: string | undefined,
  path: string
): Promise<string> {
  return invoke('kaggle_kernel_output_download', { accountId, kernel, file, path })
}

// Local folder listing (pick code file for push)
export async function listKaggleFolderFiles(path: string): Promise<string[]> {
  return invoke('kaggle_list_folder_files', { path })
}

// Dataset commands
export async function listKaggleDatasets(accountId: string): Promise<KaggleDataset[]> {
  return invoke('kaggle_datasets', { accountId })
}

export async function listKaggleDatasetFiles(
  accountId: string,
  dataset: string
): Promise<KaggleDatasetFile[]> {
  return invoke('kaggle_dataset_files', { accountId, dataset })
}

export async function downloadKaggleDataset(
  accountId: string,
  dataset: string,
  file: string | undefined,
  path: string,
  unzip: boolean
): Promise<string> {
  return invoke('kaggle_dataset_download', { accountId, dataset, file, path, unzip })
}

export async function createKaggleDataset(
  accountId: string,
  folder: string,
  title: string,
  slug: string,
  license: string,
  isPublic: boolean
): Promise<string> {
  return invoke('kaggle_dataset_create', { accountId, folder, title, slug, license, isPublic })
}

export async function createKaggleDatasetVersion(
  accountId: string,
  folder: string,
  dataset: string,
  notes: string
): Promise<string> {
  return invoke('kaggle_dataset_version', { accountId, folder, dataset, notes })
}
