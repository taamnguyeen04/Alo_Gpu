import { useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Download, ExternalLink, FolderOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  useDownloadKaggleDataset,
  useKaggleDatasetFiles,
} from '@/hooks/use-kaggle'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { fmtBytes } from '../fmt'

type DatasetFilesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string | null
  datasetRef: string | null
  datasetTitle: string
}

export function DatasetFilesDialog({
  open,
  onOpenChange,
  accountId,
  datasetRef,
  datasetTitle,
}: DatasetFilesDialogProps) {
  const [outDir, setOutDir] = useState<string | null>(null) // chosen download dir
  const [unzip, setUnzip] = useState(false)
  const downloadMutation = useDownloadKaggleDataset()

  const filesQuery = useKaggleDatasetFiles(
    accountId ?? undefined,
    datasetRef ?? undefined,
    { enabled: open && !!datasetRef }
  )

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
    if (!accountId || !datasetRef) return
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
        dataset: datasetRef,
        file,
        path: dir,
        unzip,
      })
      toast.success(msg || 'Downloaded')
    } catch (e) {
      toast.error(`Download failed: ${e}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            <span
              className='truncate'
              title={datasetTitle || datasetRef || undefined}
            >
              {datasetTitle || datasetRef}
            </span>
            {datasetRef && (
              <a
                href={`https://www.kaggle.com/datasets/${datasetRef}`}
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
            {datasetRef} — download to feed kernels as a dataset source
          </DialogDescription>
        </DialogHeader>

        <div className='mb-2 flex items-center justify-between gap-2'>
          <span
            className='min-w-0 truncate text-xs text-muted-foreground'
            title={outDir ?? undefined}
          >
            {outDir ? `→ ${outDir}` : 'No folder chosen yet'}
          </span>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2'>
              <Label
                htmlFor='dataset-unzip'
                className='cursor-pointer text-xs font-normal'
              >
                Unzip
              </Label>
              <Switch
                id='dataset-unzip'
                checked={unzip}
                onCheckedChange={setUnzip}
                disabled={downloadMutation.isPending}
              />
            </div>
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
              Download all (zip)
            </Button>
          </div>
        </div>

        {filesQuery.isLoading ? (
          <Skeleton className='h-24 w-full' />
        ) : filesQuery.error ? (
          <p className='py-2 text-sm text-destructive'>
            Failed to list files: {String(filesQuery.error)}
          </p>
        ) : (filesQuery.data?.length ?? 0) === 0 ? (
          <p className='py-4 text-sm text-muted-foreground'>No files found.</p>
        ) : (
          <div className='max-h-[360px] overflow-auto rounded-md border'>
            {filesQuery.data?.map((f) => (
              <div
                key={f.name}
                className='flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0'
              >
                <div className='min-w-0'>
                  <div className='truncate font-mono text-xs' title={f.name}>
                    {f.name}
                  </div>
                  <div className='text-[10px] text-muted-foreground'>
                    {/^\d+$/.test(f.size)
                      ? fmtBytes(Number(f.size))
                      : f.size || '—'}
                    {f.creation_date ? ` • ${f.creation_date}` : ''}
                  </div>
                </div>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7 shrink-0'
                  title='Download file'
                  onClick={() => void handleDownload(f.name)}
                  disabled={downloadMutation.isPending}
                >
                  <Download className='h-3.5 w-3.5' />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
