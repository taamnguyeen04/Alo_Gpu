// Hooks for Kaggle API
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useKaggleStore } from '@/stores/kaggle-store'
import * as kaggleApi from '@/lib/kaggle-api'
import type {
  KaggleKernelPushConfig,
  KaggleRunProjectConfig,
} from '@/lib/kaggle-types'

// Log buffers can get huge in long runs — keep the tail only when rendering
const MAX_LOG_LENGTH = 300000

function dataCap300k(log: string): string {
  if (!log || log.length <= MAX_LOG_LENGTH) return log
  return log.slice(-MAX_LOG_LENGTH)
}

// Query keys
export const kaggleKeys = {
  cliAvailable: ['kaggleCliAvailable'] as const,
  accounts: ['kaggleAccounts'] as const,
  activeGlobal: ['kaggleActiveGlobal'] as const,
  quota: (accountId?: string) => ['kaggleQuota', accountId] as const,
  // Reserved for later milestones:
  datasets: (accountId?: string) => ['kaggleDatasets', accountId] as const,
  kernels: (accountId?: string) => ['kaggleKernels', accountId] as const,
  kernelStatus: (accountId?: string, kernel?: string) =>
    ['kaggleKernelStatus', accountId, kernel] as const,
  kernelLogs: (accountId?: string, kernel?: string) =>
    ['kaggleKernelLogs', accountId, kernel] as const,
  kernelFiles: (accountId?: string, kernel?: string) =>
    ['kaggleKernelFiles', accountId, kernel] as const,
  folderFiles: (path?: string) => ['kaggleFolderFiles', path] as const,
  datasetFiles: (accountId?: string, dataset?: string) =>
    ['kaggleDatasetFiles', accountId, dataset] as const,
}

type ConditionalQueryOpts = {
  enabled?: boolean
  refetchInterval?:
    number | false | ((query: unknown) => number | false | undefined)
}

// CLI availability
export function useKaggleCliAvailable() {
  return useQuery({
    queryKey: kaggleKeys.cliAvailable,
    queryFn: () => kaggleApi.kaggleCliAvailable(),
    staleTime: 60000,
  })
}

// Accounts hooks
export function useKaggleAccounts() {
  const setAccounts = useKaggleStore((s) => s.setAccounts)

  return useQuery({
    queryKey: kaggleKeys.accounts,
    queryFn: async () => {
      const accounts = await kaggleApi.listKaggleAccounts()
      setAccounts(accounts)
      return accounts
    },
    staleTime: 30000, // 30 seconds
  })
}

export function useKaggleActiveGlobal() {
  return useQuery({
    queryKey: kaggleKeys.activeGlobal,
    queryFn: () => kaggleApi.getKaggleActiveGlobal(),
  })
}

export function useKaggleQuota(accountId?: string) {
  return useQuery({
    queryKey: kaggleKeys.quota(accountId),
    queryFn: () => kaggleApi.getKaggleQuota(accountId as string),
    enabled: !!accountId,
    staleTime: 60000,
  })
}

export function useAddKaggleAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { label: string; username: string; key: string }) =>
      kaggleApi.addKaggleAccount(data.label, data.username, data.key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kaggleKeys.accounts })
      queryClient.invalidateQueries({ queryKey: kaggleKeys.activeGlobal })
    },
  })
}

export function useAddKaggleTokenAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { label: string; token: string }) =>
      kaggleApi.addKaggleTokenAccount(data.label, data.token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kaggleKeys.accounts })
      queryClient.invalidateQueries({ queryKey: kaggleKeys.activeGlobal })
    },
  })
}

export function useUpdateKaggleAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { accountId: string; label: string }) =>
      kaggleApi.updateKaggleAccount(data.accountId, data.label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kaggleKeys.accounts })
    },
  })
}

export function useRemoveKaggleAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (accountId: string) => kaggleApi.removeKaggleAccount(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kaggleKeys.accounts })
      queryClient.invalidateQueries({ queryKey: kaggleKeys.activeGlobal })
    },
  })
}

export function useSetKaggleActiveAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (accountId: string) =>
      kaggleApi.setKaggleActiveAccount(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: kaggleKeys.accounts })
      queryClient.invalidateQueries({ queryKey: kaggleKeys.activeGlobal })
    },
  })
}

// --- Kernels (M2) ---

export function useKaggleKernels(accountId?: string) {
  return useQuery({
    queryKey: kaggleKeys.kernels(accountId),
    queryFn: () => kaggleApi.listKaggleKernels(accountId as string),
    enabled: !!accountId,
    staleTime: 15000,
  })
}

export function useKaggleKernelStatus(
  accountId?: string,
  kernel?: string,
  opts?: ConditionalQueryOpts
) {
  return useQuery({
    queryKey: kaggleKeys.kernelStatus(accountId, kernel),
    queryFn: () =>
      kaggleApi.getKaggleKernelStatus(accountId as string, kernel as string),
    enabled: !!accountId && !!kernel && (opts?.enabled ?? true),
    refetchInterval: opts?.refetchInterval ?? false,
  })
}

export function useKaggleKernelLogs(
  accountId?: string,
  kernel?: string,
  opts?: ConditionalQueryOpts
) {
  return useQuery({
    queryKey: kaggleKeys.kernelLogs(accountId, kernel),
    queryFn: () =>
      kaggleApi.getKaggleKernelLogs(accountId as string, kernel as string),
    enabled: !!accountId && !!kernel && (opts?.enabled ?? true),
    refetchInterval: opts?.refetchInterval ?? false,
    select: dataCap300k,
  })
}

export function useKaggleKernelFiles(
  accountId?: string,
  kernel?: string,
  opts?: ConditionalQueryOpts
) {
  return useQuery({
    queryKey: kaggleKeys.kernelFiles(accountId, kernel),
    queryFn: () =>
      kaggleApi.listKaggleKernelOutputFiles(
        accountId as string,
        kernel as string
      ),
    enabled: !!accountId && !!kernel && (opts?.enabled ?? true),
  })
}

export function useKaggleFolderFiles(path?: string) {
  return useQuery({
    queryKey: kaggleKeys.folderFiles(path),
    queryFn: () => kaggleApi.listKaggleFolderFiles(path as string),
    enabled: !!path,
    staleTime: 5000,
  })
}

export function usePushKaggleKernel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      accountId: string
      folder: string
      config: KaggleKernelPushConfig
      noRun: boolean
    }) =>
      kaggleApi.pushKaggleKernel(
        data.accountId,
        data.folder,
        data.config,
        data.noRun
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kaggleKernels'] })
    },
  })
}

export function useDownloadKaggleKernelOutput() {
  return useMutation({
    mutationFn: (data: {
      accountId: string
      kernel: string
      file?: string
      path: string
    }) =>
      kaggleApi.downloadKaggleKernelOutput(
        data.accountId,
        data.kernel,
        data.file,
        data.path
      ),
  })
}

// --- AloRun (M4) ---

export function useKaggleProjectScan(projectRoot?: string) {
  return useQuery({
    queryKey: ['kaggleProjectScan', projectRoot],
    queryFn: () => kaggleApi.scanKaggleProject(projectRoot as string),
    enabled: !!projectRoot,
    staleTime: 15000,
  })
}

export function useRunKaggleProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      accountId: string
      projectRoot: string
      config: KaggleRunProjectConfig
    }) =>
      kaggleApi.runKaggleProject(data.accountId, data.projectRoot, data.config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kaggleKernels'] })
    },
  })
}

// --- Datasets (M3) ---

export function useKaggleDatasets(accountId?: string) {
  return useQuery({
    queryKey: kaggleKeys.datasets(accountId),
    queryFn: () => kaggleApi.listKaggleDatasets(accountId as string),
    enabled: !!accountId,
    staleTime: 30000,
  })
}

export function useKaggleDatasetFiles(
  accountId?: string,
  dataset?: string,
  opts?: ConditionalQueryOpts
) {
  return useQuery({
    queryKey: kaggleKeys.datasetFiles(accountId, dataset),
    queryFn: () =>
      kaggleApi.listKaggleDatasetFiles(accountId as string, dataset as string),
    enabled: !!accountId && !!dataset && (opts?.enabled ?? true),
    staleTime: 60000,
  })
}

export function useDownloadKaggleDataset() {
  return useMutation({
    mutationFn: (data: {
      accountId: string
      dataset: string
      file?: string
      path: string
      unzip: boolean
    }) =>
      kaggleApi.downloadKaggleDataset(
        data.accountId,
        data.dataset,
        data.file,
        data.path,
        data.unzip
      ),
  })
}

export function useCreateKaggleDataset() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      accountId: string
      folder: string
      title: string
      slug: string
      license: string
      isPublic: boolean
    }) =>
      kaggleApi.createKaggleDataset(
        data.accountId,
        data.folder,
        data.title,
        data.slug,
        data.license,
        data.isPublic
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kaggleDatasets'] })
    },
  })
}

export function useCreateKaggleDatasetVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      accountId: string
      folder: string
      dataset: string
      notes: string
    }) =>
      kaggleApi.createKaggleDatasetVersion(
        data.accountId,
        data.folder,
        data.dataset,
        data.notes
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kaggleDatasets'] })
    },
  })
}
