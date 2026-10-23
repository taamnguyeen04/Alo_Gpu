import { useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  AlertTriangle,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useDownloadKaggleKernelOutput,
  useKaggleKernelFiles,
  useKaggleKernelLogs,
  useKaggleKernelStatus,
} from '@/hooks/use-kaggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type KernelViewerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string | null
  kernelRef: string | null
  title: string
}

const RUNNING_STATES = [
  'running',
  'queued',
  'cancelrequested',
  'cancelacknowledged',
]

export function KernelViewer({
  open,
  onOpenChange,
  accountId,
  kernelRef,
  title,
}: KernelViewerProps) {
  const [tab, setTab] = useState<'log' | 'output'>('log')
  const [outDir, setOutDir] = useState<string | null>(null)
  const downloadMutation = useDownloadKaggleKernelOutput()

  // Poll status with 5s interval only while the kernel is running/queued
  const { data: status } = useKaggleKernelStatus(
    accountId ?? undefined,
    kernelRef ?? undefined,
    {
      enabled: open,
      refetchInterval: (query) => {
        const st = (
          (query as { state?: { data?: { status?: string } } }).state?.data
            ?.status ?? ''
        ).toLowerCase()
        return st && RUNNING_STATES.some((s) => st.includes(s)) ? 5000 : false
      },
    }
  )
  const isRunning =
    !!status &&
    RUNNING_STATES.some((s) => status.status.toLowerCase().includes(s))

  const logsQuery = useKaggleKernelLogs(
    accountId ?? undefined,
    kernelRef ?? undefined,
    {
      enabled: open && tab === 'log',
      refetchInterval: isRunning ? 5000 : false,
    }
  )

  const filesQuery = useKaggleKernelFiles(
    accountId ?? undefined,
    kernelRef ?? undefined,
    { enabled: open && tab === 'output' }
  )

  const logText = logsQuery.data ?? ''

  const handleCopyLog = async () => {
    try {
      await navigator.clipboard.writeText(logsQuery.data ?? '')
      toast.success('Log copied to clipboard')
    } catch (e) {
      toast.error(`Failed to copy: ${e}`)
    }
  }

  const pickFolder = async () => {
    const picked = await openDialog({
      multiple: false,
      directory: true,
      title: 'Choose download folder',
    })
    if (typeof picked === 'string') {
      setOutDir(picked)
      return picked
    }
    return null
  }

  const handleDownload = async (file?: string) => {
    if (!accountId || !kernelRef) return
    let dir = outDir
    if (!dir) {
      const picked = await pickFolder()
      if (!picked) {
        toast.info('Choose a download folder first')
        return
      }
      dir = picked
    }
    try {
      const msg = await downloadMutation.mutateAsync({
        accountId,
        kernel: kernelRef,
        file,
        path: dir,
      })
      toast.success(msg || 'Output downloaded')
    } catch (e) {
      toast.error(`Download failed: ${e}`)
    }
  }

  const statusVariant = (s: string) => {
    const lower = s.toLowerCase()
    if (lower.includes('running') || lower.includes('queued')) return 'default'
    if (lower.includes('complete') || lower.includes('finished'))
      return 'secondary'
    if (lower.includes('error') || lower.includes('fail')) return 'destructive'
    return 'outline'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            <span className='truncate' title={title || kernelRef || undefined}>
              {title || kernelRef}
            </span>
            {status && (
              <Badge variant={statusVariant(status.status)}>
                {status.status}
              </Badge>
            )}
            {kernelRef && (
              <a
                href={`https://www.kaggle.com/code/${kernelRef}`}
                target='_blank'
                rel='noreferrer'
                className='text-muted-foreground hover:text-primary'
                title='Open on Kaggle'
              >
                <ExternalLink className='h-4 w-4' />
              </a>
            )}
          </DialogTitle>
          <DialogDescription className='font-mono text-xs'>
            {isRunning ? 'Polling status every 5s…' : kernelRef}
          </DialogDescription>
        </DialogHeader>

        {status?.failure_message && (
          <div className='flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <span className='break-all'>{status.failure_message}</span>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'log' | 'output')}>
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='log'>Log</TabsTrigger>
            <TabsTrigger value='output'>Output</TabsTrigger>
          </TabsList>

          <TabsContent value='log' className='mt-3'>
            {logsQuery.isLoading ? (
              <div className='space-y-2 py-4'>
                <Skeleton className='h-4 w-3/4' />
                <Skeleton className='h-4 w-2/3' />
                <Skeleton className='h-4 w-1/2' />
              </div>
            ) : logsQuery.error ? (
              <p className='py-4 text-sm text-destructive'>
                Failed to load log: {String(logsQuery.error)}
              </p>
            ) : logText.trim() ? (
              <>
                <div className='mb-2 flex items-center justify-between'>
                  <span className='text-xs text-muted-foreground'>
                    {isRunning ? 'Live (5s)' : 'Last execution'} —{' '}
                    {logText.length.toLocaleString()} chars
                  </span>
                  <div className='flex gap-1'>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7'
                      title='Copy log'
                      onClick={handleCopyLog}
                    >
                      <Copy className='h-3.5 w-3.5' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7'
                      title='Reload'
                      onClick={() => void logsQuery.refetch()}
                    >
                      <RefreshCw className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                </div>
                <pre className='max-h-[400px] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap'>
                  {logText}
                </pre>
              </>
            ) : (
              <p className='py-4 text-sm text-muted-foreground'>
                No log for this kernel yet — it appears after the first run.
              </p>
            )}
          </TabsContent>

          <TabsContent value='output' className='mt-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <span
                className='min-w-0 truncate text-xs text-muted-foreground'
                title={outDir ?? undefined}
              >
                {outDir ? `→ ${outDir}` : 'No folder chosen yet'}
              </span>
              <div className='flex gap-1'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => void pickFolder()}
                >
                  <FolderOpen className='mr-2 h-3.5 w-3.5' />
                  Folder
                </Button>
                <Button
                  size='sm'
                  onClick={() => void handleDownload(undefined)}
                  disabled={downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <Download className='mr-2 h-3.5 w-3.5' />
                  )}
                  Download all
                </Button>
              </div>
            </div>
            {filesQuery.isLoading ? (
              <Skeleton className='h-24 w-full' />
            ) : filesQuery.error ? (
              <p className='py-2 text-sm text-destructive'>
                Failed to list output: {String(filesQuery.error)}
              </p>
            ) : (filesQuery.data?.length ?? 0) === 0 ? (
              <p className='py-4 text-sm text-muted-foreground'>
                No output files yet.
              </p>
            ) : (
              <div className='max-h-[320px] overflow-auto rounded-md border'>
                {filesQuery.data?.map((f) => (
                  <div
                    key={f.name}
                    className='flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0'
                  >
                    <div className='min-w-0'>
                      <div
                        className='truncate font-mono text-xs'
                        title={f.name}
                      >
                        {f.name}
                      </div>
                      <div className='text-[10px] text-muted-foreground'>
                        {f.size}
                        {f.creation_date ? ` • ${f.creation_date}` : ''}
                      </div>
                    </div>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 shrink-0'
                      title='Download file'
                      onClick={() => void handleDownload(f.name)}
                    >
                      <Download className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
