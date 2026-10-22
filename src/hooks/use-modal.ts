// Hooks for Modal API
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useModalStore } from '@/stores/modal-store'
import * as modalApi from '@/lib/modal-api'
import { notificationService } from '@/lib/notifications'

// Query keys
export const queryKeys = {
  profiles: ['profiles'] as const,
  currentProfile: ['currentProfile'] as const,
  apps: (profile?: string) => ['apps', profile] as const,
  volumes: (profile?: string) => ['volumes', profile] as const,
  volumeFiles: (name: string, path?: string) =>
    ['volumeFiles', name, path] as const,
  secrets: (profile?: string) => ['secrets', profile] as const,
  appLogs: (name: string) => ['appLogs', name] as const,
}

const MAX_LOG_LENGTH = 500000

// Merge newly fetched logs into the accumulated buffer, trimming the overlap
function mergeLogs(previous: string, current: string) {
  if (!current) return previous

  if (!previous) {
    return current.length > MAX_LOG_LENGTH
      ? current.slice(-MAX_LOG_LENGTH)
      : current
  }

  // Take the last few lines of the previous buffer to find the overlap
  const previousLines = previous.trim().split('\n')
  const searchLen = Math.min(previousLines.length, 5)
  const searchChunk = previousLines.slice(-searchLen).join('\n')

  const idx = current.lastIndexOf(searchChunk)
  const appended =
    idx !== -1 ? current.substring(idx + searchChunk.length) : '\n' + current
  const merged = previous + appended

  return merged.length > MAX_LOG_LENGTH ? merged.slice(-MAX_LOG_LENGTH) : merged
}

// Profiles hooks
export function useProfiles() {
  const setProfiles = useModalStore((s) => s.setProfiles)

  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: async () => {
      const profiles = await modalApi.listProfiles()
      setProfiles(profiles)
      return profiles
    },
    staleTime: 30000, // 30 seconds
  })
}

export function useCurrentProfile() {
  const setCurrentProfile = useModalStore((s) => s.setCurrentProfile)

  return useQuery({
    queryKey: queryKeys.currentProfile,
    queryFn: async () => {
      const profile = await modalApi.getCurrentProfile()
      setCurrentProfile(profile)
      return profile
    },
  })
}

export function useActivateProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (name: string) => {
      await modalApi.activateProfile(name)
      notificationService.notifyProfileSwitched(name)
      return name
    },
    onSuccess: () => {
      // Refresh profiles and current profile
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles })
      queryClient.invalidateQueries({ queryKey: queryKeys.currentProfile })
    },
  })
}

// Apps hooks
export function useApps(profile?: string) {
  return useQuery({
    queryKey: queryKeys.apps(profile),
    queryFn: () => modalApi.listApps(profile),
    enabled: !!profile,
  })
}

export function useAppLogs(appName: string) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: queryKeys.appLogs(appName),
    // Accumulate logs across polls so the buffer keeps growing
    queryFn: async () => {
      const logs = await modalApi.getAppLogs(appName)
      const previous = queryClient.getQueryData<string>(
        queryKeys.appLogs(appName)
      )
      return previous !== undefined ? mergeLogs(previous, logs) : logs
    },
    enabled: !!appName,
    refetchInterval: 5000, // Refresh logs every 5 seconds
  })
}

export function useStopApp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (appName: string) => modalApi.stopApp(appName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apps'] })
    },
  })
}

// Volumes hooks
export function useVolumes(profile?: string) {
  return useQuery({
    queryKey: queryKeys.volumes(profile),
    queryFn: () => modalApi.listVolumes(profile),
    enabled: !!profile,
  })
}

export function useVolumeFiles(volumeName: string, path?: string) {
  return useQuery({
    queryKey: queryKeys.volumeFiles(volumeName, path),
    queryFn: () => modalApi.volumeLs(volumeName, path),
    enabled: !!volumeName,
  })
}

export function useVolumeCreate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => modalApi.volumeCreate(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] })
    },
  })
}

export function useVolumeDelete() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => modalApi.volumeDelete(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] })
    },
  })
}

// System hooks
export function useSystemInfo() {
  return useQuery({
    queryKey: ['systemInfo'],
    queryFn: () => modalApi.getSystemInfo(),
    staleTime: Infinity, // System info rarely changes
  })
}

// Secret hooks
export function useSecrets(profile?: string) {
  return useQuery({
    queryKey: queryKeys.secrets(profile),
    queryFn: () => modalApi.listSecrets(profile),
  })
}

export function useCreateSecret() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      name: string
      keyvalues: { key: string; value: string }[]
    }) => modalApi.createSecret(data.name, data.keyvalues),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets'] })
    },
  })
}

export function useDeleteSecret() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => modalApi.deleteSecret(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets'] })
    },
  })
}

// Billing hooks
export function useBillingSummary(profile?: string, refetchInterval?: number) {
  return useQuery({
    queryKey: ['billingSummary', profile],
    queryFn: () => modalApi.getBillingSummary(profile),
    enabled: !!profile,
    refetchInterval,
  })
}

export function useBillingRates(profile?: string) {
  return useQuery({
    queryKey: ['billingRates', profile],
    queryFn: () => modalApi.getBillingRates(profile),
    enabled: !!profile,
  })
}

export function useVolumeReadFile() {
  return useMutation({
    mutationFn: async ({
      volumeName,
      path,
    }: {
      volumeName: string
      path: string
    }) => {
      return await invoke<string>('volume_read_file', { volumeName, path })
    },
  })
}
