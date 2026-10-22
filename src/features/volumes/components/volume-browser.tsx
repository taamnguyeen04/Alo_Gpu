import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { save, open } from '@tauri-apps/plugin-dialog'
import {
  Folder,
  File,
  ArrowLeft,
  Trash2,
  RefreshCw,
  ChevronRight,
  Loader2,
  Copy,
  Download,
  LineChart,
} from 'lucide-react'
import { toast } from 'sonner'
import { volumeGet, volumeRm } from '@/lib/modal-api'
import { useVolumeFiles, useVolumeReadFile } from '@/hooks/use-modal'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface VolumeBrowserProps {
  volumeName: string
}

interface FileItem {
  name: string
  type: 'directory' | 'file'
  size: string
  modified: string
}

export function VolumeBrowser({ volumeName }: VolumeBrowserProps) {
  const navigate = useNavigate()
  const [currentPath, setCurrentPath] = useState('')

  // Viewing state
  const [viewFile, setViewFile] = useState<FileItem | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [isViewing, setIsViewing] = useState(false)
  const readFileMutation = useVolumeReadFile()

  const handleViewFile = async (file: FileItem) => {
    setViewFile(file)
    setFileContent('')
    setIsViewing(true)

    try {
      const content = await readFileMutation.mutateAsync({
        volumeName,
        path: file.name,
      })
      setFileContent(content)
    } catch (error) {
      toast.error(`Failed to read file: ${error}`)
      setIsViewing(false)
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteType, setDeleteType] = useState<'file' | 'directory'>('file')
  const [isDeleting, setIsDeleting] = useState(false)
  const [downloadingItems, setDownloadingItems] = useState<Set<string>>(
    new Set()
  )

  // Use React Query for caching and fetching
  const {
    data: files = [],
    isLoading,
    isRefetching,
    refetch,
  } = useVolumeFiles(volumeName, currentPath)

  const handleNavigate = (path: string) => {
    setCurrentPath(path)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await volumeRm(volumeName, deleteTarget)
      toast.success(`Deleted: ${deleteTarget.split('/').pop()}`)
      setDeleteTarget(null)
      refetch()
    } catch (error) {
      toast.error(`Failed to delete: ${error}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCopyPath = (name: string) => {
    navigator.clipboard.writeText(name)
    toast.success('Path copied to clipboard')
  }

  const handleLaunchTensorboard = async (file: FileItem) => {
    try {
      setDownloadingItems((prev) => new Set(prev).add(file.name + '_tb'))

      const parts = file.name.split('/')
      parts.pop() // remove filename
      const parentDir = parts.join('/') || '/'

      const { tempDir, join } = await import('@tauri-apps/api/path')
      const t = await tempDir()
      const uniqueId = Math.random().toString(36).substring(7)
      const localParent = await join(
        t,
        'modal_tensorboard',
        volumeName,
        `${parentDir.replace(/\//g, '_')}_${uniqueId}`
      )

      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('create_tensorboard_dir', { path: localParent })

      toast.promise(
        (async () => {
          // Download directory
          await volumeGet(volumeName, parentDir, localParent)
          // Start tensorboard
          const { invoke } = await import('@tauri-apps/api/core')
          const res = await invoke<{ url: string }>('start_tensorboard', {
            logdir: localParent,
          })

          // Navigate to tensorboard page with URL
          navigate({ to: '/tensorboard', search: { url: res.url } })
        })().finally(() => {
          setDownloadingItems((prev) => {
            const next = new Set(prev)
            next.delete(file.name + '_tb')
            return next
          })
        }),
        {
          loading: 'Starting TensorBoard (downloading logs)...',
          success: 'TensorBoard started!',
          error: (err) => `Failed to start TensorBoard: ${err}`,
        }
      )
    } catch (error) {
      toast.error(`Error: ${error}`)
    }
  }

  const handleDownload = async (file: FileItem) => {
    try {
      let savePath: string | null = null

      if (file.type === 'directory') {
        savePath = (await open({
          directory: true,
          multiple: false,
        })) as string | null
      } else {
        const defaultName = file.name.split('/').pop() || 'file'
        savePath = await save({
          defaultPath: defaultName,
        })
      }

      if (savePath) {
        setDownloadingItems((prev) => new Set(prev).add(file.name))

        toast.promise(
          volumeGet(volumeName, file.name, savePath).finally(() => {
            setDownloadingItems((prev) => {
              const next = new Set(prev)
              next.delete(file.name)
              return next
            })
          }),
          {
            loading: `Downloading ${file.name.split('/').pop()}...`,
            success: `Downloaded ${file.type} successfully to ${savePath.split(/[/\\]/).pop()}`,
            error: (err) => `Download failed: ${err}`,
          }
        )
      }
    } catch (error) {
      toast.error(`Error: ${error}`)
      setDownloadingItems((prev) => {
        const next = new Set(prev)
        next.delete(file.name)
        return next
      })
    }
  }

  // Modal CLI already returns the full path in file.name
  const buildPath = (fileName: string) => {
    return fileName
  }

  const getParentPath = () => {
    if (!currentPath) return ''
    const parts = currentPath.split('/')
    parts.pop()
    return parts.join('/')
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='icon'
              onClick={() => handleNavigate(getParentPath())}
              disabled={!currentPath}
            >
              <ArrowLeft className='h-4 w-4' />
            </Button>
            <div>
              <h3 className='font-medium'>{volumeName}</h3>
              {currentPath && (
                <p className='text-sm text-muted-foreground'>/{currentPath}</p>
              )}
            </div>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className='space-y-2'>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className='h-10 w-full' />
            ))}
          </div>
        )}

        {!isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className='w-24'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className='py-8 text-center text-muted-foreground'
                  >
                    This folder is empty
                  </TableCell>
                </TableRow>
              )}
              {files.map((file) => (
                <TableRow
                  key={file.name}
                  className='cursor-pointer'
                  onClick={() => {
                    if (file.type === 'directory') {
                      handleNavigate(buildPath(file.name))
                    } else {
                      handleViewFile(file)
                    }
                  }}
                >
                  <TableCell>
                    {file.type === 'directory' ? (
                      <Folder className='h-4 w-4 text-yellow-500' />
                    ) : (
                      <File className='h-4 w-4 text-muted-foreground' />
                    )}
                  </TableCell>
                  <TableCell className='font-medium'>
                    {file.name.split('/').pop()}
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    {file.size || (file.type === 'directory' ? '-' : '0 B')}
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-1'>
                      {file.type === 'directory' && (
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8'
                          onClick={(e) => {
                            e.stopPropagation()
                            handleNavigate(buildPath(file.name))
                          }}
                        >
                          <ChevronRight className='h-4 w-4' />
                        </Button>
                      )}
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCopyPath(file.name)
                        }}
                        title='Copy path'
                      >
                        <Copy className='h-4 w-4' />
                      </Button>
                      {file.type === 'file' &&
                        (file.name.includes('tfevents') ||
                          file.name.includes('events.out')) && (
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-8 w-8 text-orange-500 hover:bg-orange-100 hover:text-orange-600 dark:hover:bg-orange-900/20'
                            onClick={(e) => {
                              e.stopPropagation()
                              handleLaunchTensorboard(file)
                            }}
                            disabled={downloadingItems.has(file.name + '_tb')}
                            title='View in TensorBoard'
                          >
                            {downloadingItems.has(file.name + '_tb') ? (
                              <Loader2 className='h-4 w-4 animate-spin' />
                            ) : (
                              <LineChart className='h-4 w-4' />
                            )}
                          </Button>
                        )}
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8 text-primary hover:text-primary'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownload(file)
                        }}
                        disabled={downloadingItems.has(file.name)}
                        title='Download'
                      >
                        {downloadingItems.has(file.name) ? (
                          <Loader2 className='h-4 w-4 animate-spin' />
                        ) : (
                          <Download className='h-4 w-4' />
                        )}
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8 text-destructive hover:text-destructive'
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTarget(buildPath(file.name))
                          setDeleteType(file.type)
                        }}
                        title='Delete'
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this {deleteType}?
              <br />
              <code className='mt-2 block rounded bg-muted p-2 text-sm break-all'>
                {deleteTarget?.split('/').pop()}
              </code>
              <br />
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File Viewer Dialog */}
      <Dialog
        open={!!viewFile}
        onOpenChange={(open) => {
          if (!open) {
            setViewFile(null)
            setFileContent('')
            setIsViewing(false)
          }
        }}
      >
        <DialogContent className='flex max-h-[85vh] w-full max-w-[80vw] flex-col'>
          <DialogHeader>
            <DialogTitle className='break-all'>
              {viewFile?.name.split('/').pop()}
            </DialogTitle>
          </DialogHeader>
          <div className='flex flex-1 items-center justify-center overflow-auto rounded-md border bg-muted/30 p-4'>
            {isViewing && !fileContent ? (
              <div className='flex flex-col items-center justify-center gap-2 text-muted-foreground'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <span>Reading file from volume...</span>
              </div>
            ) : fileContent.startsWith('data:image/') ? (
              <img
                src={fileContent}
                alt={viewFile?.name}
                className='max-h-full max-w-full object-contain'
              />
            ) : (
              <pre className='h-full w-full overflow-auto p-4 text-left font-mono text-sm whitespace-pre-wrap'>
                {fileContent}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
