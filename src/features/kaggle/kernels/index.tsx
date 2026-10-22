import { useEffect, useState } from 'react'
import {
  ExternalLink,
  Eye,
  FileCode,
  Loader2,
  Play,
  RotateCw,
  ThumbsUp,
} from 'lucide-react'
import { useKaggleAccounts, useKaggleKernels } from '@/hooks/use-kaggle'
import { useKaggleStore } from '@/stores/kaggle-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { KernelViewer } from './components/kernel-viewer'
import { NewRunDialog } from './components/new-run-dialog'
import type { KaggleKernel } from '@/lib/kaggle-types'

export function KaggleKernelsPage() {
  const { data: accounts } = useKaggleAccounts()
  const currentAccountId = useKaggleStore((s) => s.currentAccountId)
  const setCurrentAccountId = useKaggleStore((s) => s.setCurrentAccountId)

  const managedAccounts = (accounts || []).filter((a) => a.source === 'managed')
  const activeAccount =
    managedAccounts.find((a) => a.id === (currentAccountId ?? '')) ??
    managedAccounts.find((a) => a.is_active_global) ??
    managedAccounts[0]

  const accountId = activeAccount?.id ?? null

  // Keep the shared store selection valid
  useEffect(() => {
    if (activeAccount && activeAccount.id !== currentAccountId) {
      setCurrentAccountId(activeAccount.id)
    }
  }, [activeAccount, currentAccountId, setCurrentAccountId])

  const {
    data: kernels,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useKaggleKernels(accountId || undefined)

  const [selectedKernel, setSelectedKernel] = useState<KaggleKernel | null>(null)
  const [showNewRun, setShowNewRun] = useState(false)

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2'>
          <Select
            value={activeAccount?.id ?? ''}
            onValueChange={setCurrentAccountId}
            disabled={managedAccounts.length === 0}
          >
            <SelectTrigger className='h-8 w-[190px]'>
              <SelectValue placeholder='Account' />
            </SelectTrigger>
            <SelectContent>
              {managedAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label || a.username || a.id}
                  {a.is_active_global ? ' •' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={() => void refetch()} disabled={isRefetching}>
            <RotateCw
              className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
          <Button size='sm' onClick={() => setShowNewRun(true)} disabled={!accountId}>
            <Play className='mr-2 h-4 w-4' />
            New Run
          </Button>
        </div>
      </Header>

      <Main>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold tracking-tight'>Kaggle Kernels</h1>
          <p className='text-muted-foreground'>
            Run your models on Kaggle GPU — notebooks live in {activeAccount?.username || 'your'}'s
            Code section
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className='space-y-4'>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className='h-14 w-full' />
            ))}
          </div>
        )}

        {/* Error state */}
        {!isLoading && error && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-10'>
              <FileCode className='mb-4 h-12 w-12 text-muted-foreground' />
              <h3 className='mb-2 text-lg font-semibold'>Failed to list kernels</h3>
              <p className='max-w-xl break-all text-center text-sm text-muted-foreground'>
                {String(error)}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Kernels Table */}
        {!isLoading && !error && kernels && (
          <Card>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Votes</TableHead>
                    <TableHead className='text-right'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kernels.map((k) => (
                    <TableRow key={k.ref}>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <div className='min-w-0'>
                            <div className='flex items-center gap-1.5 font-medium'>
                              <span className='truncate' title={k.title}>
                                {k.title || k.ref}
                              </span>
                              <a
                                href={`https://www.kaggle.com/code/${k.ref}`}
                                target='_blank'
                                rel='noreferrer'
                                className='text-muted-foreground hover:text-primary'
                                title='Open on Kaggle'
                              >
                                <ExternalLink className='h-3.5 w-3.5' />
                              </a>
                            </div>
                            <div className='text-sm text-muted-foreground'>{k.ref}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {k.last_run_time || '—'}
                      </TableCell>
                      <TableCell>
                        {k.total_votes > 0 ? (
                          <span className='flex items-center gap-1 text-sm'>
                            <ThumbsUp className='h-3.5 w-3.5 text-muted-foreground' />
                            {k.total_votes}
                          </span>
                        ) : (
                          <span className='text-sm text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-1'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-8 w-8'
                            title='Log & output'
                            onClick={() => setSelectedKernel(k)}
                          >
                            <Eye className='h-4 w-4' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!isLoading && !error && kernels && kernels.length === 0 && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <FileCode className='mb-4 h-12 w-12 text-muted-foreground' />
              <h3 className='mb-2 text-lg font-semibold'>No kernels yet</h3>
              <p className='mb-4 max-w-md text-center text-muted-foreground'>
                Create a run from a local notebook/script folder — Kaggle will
                execute it on GPU and the log + output will show up here.
              </p>
              <Button size='sm' onClick={() => setShowNewRun(true)} disabled={!accountId}>
                {activeAccount ? null : <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                <Play className='mr-2 h-4 w-4' />
                New Run
              </Button>
            </CardContent>
          </Card>
        )}

        {/* No accounts hint */}
        {!isLoading && managedAccounts.length === 0 && (
          <div className='mt-4 flex justify-center'>
            <Badge variant='secondary'>Add a Kaggle account first (Accounts page)</Badge>
          </div>
        )}
      </Main>

      <KernelViewer
        key={selectedKernel?.ref ?? 'none'}
        open={!!selectedKernel}
        onOpenChange={(open) => {
          if (!open) setSelectedKernel(null)
        }}
        accountId={accountId}
        kernelRef={selectedKernel?.ref ?? null}
        title={selectedKernel?.title ?? ''}
      />

      <NewRunDialog
        open={showNewRun}
        onOpenChange={setShowNewRun}
        accountId={accountId}
        /* refresh after pushes */
        onPushed={() => void refetch()}
      />
    </>
  )
}
