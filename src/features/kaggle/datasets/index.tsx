import { useEffect, useState } from 'react'
import {
  Database,
  ExternalLink,
  Eye,
  RotateCw,
  Upload,
} from 'lucide-react'
import { useKaggleAccounts, useKaggleDatasets } from '@/hooks/use-kaggle'
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
import { DatasetFilesDialog } from './components/dataset-files-dialog'
import { UploadDatasetDialog } from './components/upload-dataset-dialog'
import { fmtBytes } from './fmt'
import type { KaggleDataset } from '@/lib/kaggle-types'

export function KaggleDatasetsPage() {
  const { data: accounts } = useKaggleAccounts()
  const currentAccountId = useKaggleStore((s) => s.currentAccountId)
  const setCurrentAccountId = useKaggleStore((s) => s.setCurrentAccountId)

  const managedAccounts = (accounts || []).filter((a) => a.source === 'managed')
  const activeAccount =
    managedAccounts.find((a) => a.id === (currentAccountId ?? '')) ??
    managedAccounts.find((a) => a.is_active_global) ??
    managedAccounts[0]
  const accountId = activeAccount?.id ?? null

  useEffect(() => {
    if (activeAccount && activeAccount.id !== currentAccountId) {
      setCurrentAccountId(activeAccount.id)
    }
  }, [activeAccount, currentAccountId, setCurrentAccountId])

  const {
    data: datasets,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useKaggleDatasets(accountId || undefined)

  const [selectedDataset, setSelectedDataset] = useState<KaggleDataset | null>(null)
  const [showUpload, setShowUpload] = useState(false)

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
          <Button size='sm' onClick={() => setShowUpload(true)} disabled={!accountId}>
            <Upload className='mr-2 h-4 w-4' />
            Upload Dataset
          </Button>
        </div>
      </Header>

      <Main>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold tracking-tight'>Kaggle Datasets</h1>
          <p className='text-muted-foreground'>
            Upload training data, then reference it as a dataset source in your kernel runs
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
              <Database className='mb-4 h-12 w-12 text-muted-foreground' />
              <h3 className='mb-2 text-lg font-semibold'>Failed to list datasets</h3>
              <p className='max-w-xl break-all text-center text-sm text-muted-foreground'>
                {String(error)}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Datasets Table */}
        {!isLoading && !error && datasets && (
          <Card>
            <CardContent className='p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className='text-right'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.map((d) => (
                    <TableRow key={d.ref}>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <div className='min-w-0'>
                            <div className='flex items-center gap-1.5 font-medium'>
                              <span className='truncate' title={d.title}>
                                {d.title || d.ref}
                              </span>
                              <a
                                href={`https://www.kaggle.com/datasets/${d.ref}`}
                                target='_blank'
                                rel='noreferrer'
                                className='text-muted-foreground hover:text-primary'
                                title='Open on Kaggle'
                              >
                                <ExternalLink className='h-3.5 w-3.5' />
                              </a>
                            </div>
                            <div className='text-sm text-muted-foreground'>{d.ref}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {fmtBytes(d.total_bytes)}
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {d.last_updated || '—'}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-1'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-8 w-8'
                            title='Files & download'
                            onClick={() => setSelectedDataset(d)}
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
        {!isLoading && !error && datasets && datasets.length === 0 && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <Database className='mb-4 h-12 w-12 text-muted-foreground' />
              <h3 className='mb-2 text-lg font-semibold'>No datasets yet</h3>
              <p className='mb-4 max-w-md text-center text-muted-foreground'>
                Upload a local folder as a private dataset — use it later as a
                dataset source for your GPU kernel runs.
              </p>
              <Button size='sm' onClick={() => setShowUpload(true)} disabled={!accountId}>
                <Upload className='mr-2 h-4 w-4' />
                Upload Dataset
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

      <DatasetFilesDialog
        key={selectedDataset?.ref ?? 'none'}
        open={!!selectedDataset}
        onOpenChange={(openChange) => {
          if (!openChange) setSelectedDataset(null)
        }}
        accountId={accountId}
        datasetRef={selectedDataset?.ref ?? null}
        datasetTitle={selectedDataset?.title ?? ''}
      />

      <UploadDatasetDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        accountId={accountId}
        datasets={datasets ?? []}
        onUploaded={() => void refetch()}
      />
    </>
  )
}
