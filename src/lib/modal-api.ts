// Modal API - wrapper around Tauri invoke
import { invoke } from '@tauri-apps/api/core'
import type {
  Profile,
  App,
  Volume,
  FileItem,
  SystemInfo,
  Secret,
  SecretKeyValue,
  BillingSummary,
  BillingRates,
} from './modal-types'

// Profile commands
export async function listProfiles(): Promise<Profile[]> {
  return invoke('list_profiles')
}

export async function getCurrentProfile(): Promise<string> {
  return invoke('get_current_profile')
}

export async function activateProfile(name: string): Promise<void> {
  return invoke('activate_profile', { name })
}

// App commands
export async function listApps(profile?: string): Promise<App[]> {
  return invoke('list_apps', { profile })
}

export async function getAppLogs(appName: string): Promise<string> {
  return invoke('get_app_logs', { appName })
}

export async function stopApp(appName: string): Promise<void> {
  return invoke('stop_app', { appName })
}

// Volume commands
export async function listVolumes(profile?: string): Promise<Volume[]> {
  return invoke('list_volumes', { profile })
}

export async function volumeLs(
  volumeName: string,
  path?: string
): Promise<FileItem[]> {
  return invoke('volume_ls', { volumeName, path })
}

export async function volumeCreate(name: string): Promise<void> {
  return invoke('volume_create', { name })
}

export async function volumeDelete(name: string): Promise<void> {
  return invoke('volume_delete', { name })
}

export async function volumePut(
  volumeName: string,
  localPath: string,
  remotePath?: string
): Promise<void> {
  return invoke('volume_put', { volumeName, localPath, remotePath })
}

export async function volumeGet(
  volumeName: string,
  remotePath: string,
  localPath?: string
): Promise<void> {
  return invoke('volume_get', { volumeName, remotePath, localPath })
}

export async function volumeRm(
  volumeName: string,
  path: string
): Promise<void> {
  return invoke('volume_rm', { volumeName, path })
}

export async function volumeCp(
  volumeName: string,
  source: string,
  dest: string
): Promise<void> {
  return invoke('volume_cp', { volumeName, source, dest })
}

// Secret commands
export async function listSecrets(profile?: string): Promise<Secret[]> {
  return invoke('list_secrets', { profile })
}

export async function createSecret(
  name: string,
  keyvalues: SecretKeyValue[]
): Promise<void> {
  return invoke('create_secret', { name, keyvalues })
}

export async function deleteSecret(name: string): Promise<void> {
  return invoke('delete_secret', { name })
}

// System commands
export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke('get_system_info')
}

// Billing commands
export async function getBillingSummary(
  profile?: string
): Promise<BillingSummary> {
  return invoke('get_billing_summary', { profile })
}

export async function getBillingRates(profile?: string): Promise<BillingRates> {
  return invoke('get_billing_rates', { profile })
}
