import { useState, useEffect, useRef, useMemo } from 'react'
import {
  RotateCw,
  Copy,
  Trash2,
  Download,
  Terminal,
  Loader2,
  AlertCircle,
  Cpu,
  Clock,
  DollarSign,
} from 'lucide-react'
import { toast } from 'sonner'
import type { BillingSummary } from '@/lib/modal-types'
import {
  useAppLogs,
  useStopApp,
  useCurrentProfile,
  useBillingRates,
  useBillingSummary,
} from '@/hooks/use-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AppLogsViewerProps {
  appName: string
  open: boolean
  onClose: () => void
}

export function AppLogsViewer({ appName, open, onClose }: AppLogsViewerProps) {
  const { data: currentProfile } = useCurrentProfile()
  const { data: logs, isLoading, refetch, isRefetching } = useAppLogs(appName)
  const { data: rates } = useBillingRates(currentProfile || undefined)
  const stopAppMutation = useStopApp()

  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Training Estimator States
  const storageKey = `gpu_config_${appName}`
  const savedConfig = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}')
    } catch {
      return {}
    }
  }, [storageKey])

  // Derived GPU state: user override > saved config > first available option
  const [selectedGpuOverride, setSelectedGpuOverride] = useState<string | null>(
    null
  )
  const [gpuCountOverride, setGpuCountOverride] = useState<number | null>(null)

  // Real-time Billing Summary (refetch every 30 seconds)
  const { data: billingSummary } = useBillingSummary(
    currentProfile || undefined,
    30000
  )

  const creditsLeft = useMemo(() => {
    const summaryToUse =
      billingSummary ||
      (() => {
        try {
          const data = localStorage.getItem(`ws_billing_${currentProfile}`)
          return data ? (JSON.parse(data) as BillingSummary) : null
        } catch (error) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.error('Corrupted billing cache:', error)
          }
          return null
        }
      })()

    if (summaryToUse) {
      const creditsUsed = summaryToUse.adjustments?.credits
        ? Math.abs(parseFloat(summaryToUse.adjustments.credits))
        : 0
      return Math.max(0, 30 - creditsUsed)
    }
    return 30
  }, [billingSummary, currentProfile])

  // Get GPU Options from rates
  const gpuOptions = useMemo(() => {
    if (!rates) return []
    return Object.entries(rates)
      .filter(([k]) => k.includes('gpu_hour_cost'))
      .sort((a, b) => parseFloat(String(a[1])) - parseFloat(String(b[1])))
      .map(([k, v]) => ({
        id: k,
        name: k.replace('gpu_hour_cost_', '').toUpperCase(),
        price: parseFloat(String(v)),
      }))
  }, [rates])

  // Derived GPU state: user override > saved config > first available option
  const selectedGpu =
    selectedGpuOverride ?? savedConfig.selectedGpu ?? gpuOptions[0]?.id ?? ''
  const gpuCount = gpuCountOverride ?? savedConfig.gpuCount ?? 1

  useEffect(() => {
    if (selectedGpu) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ selectedGpu, gpuCount })
      )
    }
  }, [selectedGpu, gpuCount, storageKey])

  // Calculate estimated time
  const estimatedHours = useMemo(() => {
    if (!selectedGpu || gpuCount <= 0 || !gpuOptions.length) return 0
    const gpu = gpuOptions.find((g) => g.id === selectedGpu)
    if (!gpu || gpu.price <= 0) return 0

    const costPerHour = gpu.price * gpuCount
    return creditsLeft / costPerHour
  }, [selectedGpu, gpuCount, creditsLeft, gpuOptions])

  const formatEstimatedTime = (hours: number) => {
    if (hours === 0) return '0h 0m'
    const h = Math.floor(hours)
    const m = Math.floor((hours - h) * 60)
    return `${h}h ${m}m`
  }

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  const handleCopyLogs = () => {
    if (logs) {
      navigator.clipboard.writeText(logs)
      toast.success('Logs copied to clipboard')
    }
  }

  const handleDownloadLogs = () => {
    if (logs) {
      const blob = new Blob([logs], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${appName}-logs-${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Logs downloaded')
    }
  }

  const handleStopApp = async () => {
    try {
      await stopAppMutation.mutateAsync(appName)
      toast.success(`Deleted app ${appName}`)
      onClose()
    } catch (error) {
      toast.error(`Failed to delete app: ${error}`)
    }
  }

  const renderLogLine = (line: string, index: number) => {
    let className = 'text-sm font-mono '
    if (
      line.toLowerCase().includes('error') ||
      line.toLowerCase().includes('exception')
    ) {
      className += 'text-red-500'
    } else if (line.toLowerCase().includes('warn')) {
      className += 'text-yellow-500'
    } else if (line.toLowerCase().includes('info')) {
      className += 'text-blue-500'
    } else if (
      line.toLowerCase().includes('success') ||
      line.toLowerCase().includes('done')
    ) {
      className += 'text-green-500'
    }

    return (
      <div key={index} className={className}>
        {line}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='flex h-[95vh] w-full max-w-[95vw] flex-col sm:max-w-[95vw]'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-3 pr-8'>
            <div className='flex items-center gap-2 break-all'>
              <Terminal className='h-5 w-5 shrink-0' />
              Logs: {appName}
            </div>
            <Badge variant='outline' className='shrink-0'>
              {isRefetching ? (
                <>
                  <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                  Refreshing...
                </>
              ) : (
                'Live'
              )}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Training Estimator Dashboard */}
        <div className='mb-2 grid grid-cols-1 items-end gap-4 rounded-md border border-primary/20 bg-primary/5 p-3 md:grid-cols-3'>
          <div className='flex flex-col gap-1.5'>
            <label className='flex items-center gap-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
              <DollarSign className='h-3.5 w-3.5' /> Credits Left
            </label>
            <div className='text-xl font-bold text-green-600'>
              ${creditsLeft.toFixed(2)}
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <label className='flex items-center gap-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
              <Cpu className='h-3.5 w-3.5' /> GPU Configuration
            </label>
            <div className='flex items-center gap-2'>
              <Select
                value={selectedGpu}
                onValueChange={setSelectedGpuOverride}
              >
                <SelectTrigger className='h-8 w-[160px] text-sm'>
                  <SelectValue placeholder='Select GPU' />
                </SelectTrigger>
                <SelectContent>
                  {gpuOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} (${g.price.toFixed(2)}/h)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className='text-sm font-medium'>x</div>
              <Input
                type='number'
                min={1}
                max={100}
                value={gpuCount}
                onChange={(e) =>
                  setGpuCountOverride(parseInt(e.target.value) || 1)
                }
                className='h-8 w-20 text-center'
              />
            </div>
          </div>

          <div className='flex flex-col gap-1.5 md:items-end'>
            <label className='flex items-center gap-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
              <Clock className='h-3.5 w-3.5' /> Estimated Training Time
            </label>
            <div className='text-xl font-bold text-primary'>
              {formatEstimatedTime(estimatedHours)}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className='flex flex-wrap items-center justify-between gap-3 border-b pb-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RotateCw
                className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
            <Button
              variant={autoScroll ? 'default' : 'outline'}
              size='sm'
              onClick={() => setAutoScroll(!autoScroll)}
            >
              Auto-scroll
            </Button>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Button variant='outline' size='sm' onClick={handleCopyLogs}>
              <Copy className='mr-2 h-4 w-4' />
              Copy
            </Button>
            <Button variant='outline' size='sm' onClick={handleDownloadLogs}>
              <Download className='mr-2 h-4 w-4' />
              Download
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={handleStopApp}
              disabled={stopAppMutation.isPending}
            >
              <Trash2 className='mr-2 h-4 w-4' />
              {stopAppMutation.isPending ? 'Deleting...' : 'Delete App'}
            </Button>
          </div>
        </div>

        {/* Logs Content */}
        <div className='flex-1 overflow-auto rounded-md bg-black p-4 font-mono text-sm whitespace-pre text-gray-300'>
          {isLoading ? (
            <div className='flex h-full items-center justify-center whitespace-normal text-gray-400'>
              <Loader2 className='mr-2 h-6 w-6 animate-spin' />
              Loading logs...
            </div>
          ) : logs ? (
            <div className='space-y-0.5'>
              {logs
                .split('\n')
                .map((line, index) => renderLogLine(line, index))}
              <div ref={logsEndRef} />
            </div>
          ) : (
            <div className='flex h-full flex-col items-center justify-center whitespace-normal text-gray-400'>
              <AlertCircle className='mb-2 h-6 w-6' />
              No logs available
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
