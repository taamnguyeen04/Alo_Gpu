import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Upload,
  X,
  File as FileIcon,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { notificationService } from '@/lib/notifications'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'

interface VolumeUploaderProps {
  volumeName: string
}

interface UploadFile {
  id: string
  name: string
  localPath: string
  size: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  progress: number
  error?: string
}

export function VolumeUploader({ volumeName }: VolumeUploaderProps) {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [remotePath, setRemotePath] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [concurrency, setConcurrency] = useState(3)

  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
      })

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected]
        const newFiles: UploadFile[] = paths.map((path, index) => ({
          id: `${Date.now()}-${index}`,
          name: path.split(/[/\\]/).pop() || path,
          localPath: path,
          size: 0,
          status: 'pending',
          progress: 0,
        }))

        setFiles((prev) => [...prev, ...newFiles])
        toast.success(`Added ${paths.length} file(s)`)
      }
    } catch (error) {
      toast.error(`Failed to select files: ${error}`)
    }
  }

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      })

      if (selected) {
        const newFiles: UploadFile[] = [
          {
            id: `${Date.now()}-folder`,
            name: selected.split(/[/\\]/).pop() || selected,
            localPath: selected,
            size: 0,
            status: 'pending',
            progress: 0,
          },
        ]

        setFiles((prev) => [...prev, ...newFiles])
        toast.success('Added folder for upload')
      }
    } catch (error) {
      toast.error(`Failed to select folder: ${error}`)
    }
  }

  const handleRemoveFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const updateFileStatus = (id: string, updates: Partial<UploadFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    )
  }

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error('No files to upload')
      return
    }

    setIsUploading(true)
    const pendingFiles = files.filter((f) => f.status === 'pending')

    const uploadFile = async (file: UploadFile): Promise<void> => {
      updateFileStatus(file.id, { status: 'uploading', progress: 0 })

      try {
        // Simulate progress for better UX
        for (let i = 0; i <= 80; i += 10) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          updateFileStatus(file.id, { progress: i })
        }

        // Call Tauri command
        await invoke('volume_put', {
          volumeName,
          localPath: file.localPath,
          remotePath: remotePath || undefined,
        })

        updateFileStatus(file.id, { status: 'completed', progress: 100 })
        await notificationService.notifyUploadComplete(file.name)
        toast.success(`Uploaded: ${file.name}`)
      } catch (error) {
        updateFileStatus(file.id, { status: 'error', error: String(error) })
        toast.error(`Failed: ${file.name}`)
      }
    }

    // Upload with concurrency limit
    const uploadQueue = [...pendingFiles]
    const activePromises: Promise<void>[] = []

    const processQueue = async () => {
      while (uploadQueue.length > 0 && activePromises.length < concurrency) {
        const file = uploadQueue.shift()
        if (file) {
          const promise = uploadFile(file).finally(() => {
            const idx = activePromises.indexOf(promise)
            if (idx > -1) activePromises.splice(idx, 1)
            processQueue()
          })
          activePromises.push(promise)
        }
      }
      await Promise.all(activePromises)
    }

    await processQueue()
    setIsUploading(false)

    const completedCount = files.filter((f) => f.status === 'completed').length
    toast.success(`${completedCount}/${files.length} files uploaded!`)
  }

  const handleClearCompleted = () => {
    setFiles((prev) => prev.filter((f) => f.status !== 'completed'))
  }

  const handleRetryError = (id: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, status: 'pending', progress: 0, error: undefined }
          : f
      )
    )
  }

  const completedCount = files.filter((f) => f.status === 'completed').length
  const pendingCount = files.filter((f) => f.status === 'pending').length
  const errorCount = files.filter((f) => f.status === 'error').length
  const uploadingCount = files.filter((f) => f.status === 'uploading').length

  const totalProgress =
    files.length > 0
      ? Math.round(files.reduce((acc, f) => acc + f.progress, 0) / files.length)
      : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Upload className='h-5 w-5' />
            Upload to {volumeName}
          </div>
          {isUploading && (
            <Badge variant='default' className='bg-blue-500'>
              <Loader2 className='mr-1 h-3 w-3 animate-spin' />
              Uploading...
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {/* File Selection */}
        <div className='flex gap-2'>
          <Button
            variant='outline'
            onClick={handleSelectFiles}
            className='flex-1'
            disabled={isUploading}
          >
            <FileIcon className='mr-2 h-4 w-4' />
            Select Files
          </Button>
          <Button
            variant='outline'
            onClick={handleSelectFolder}
            className='flex-1'
            disabled={isUploading}
          >
            <FolderOpen className='mr-2 h-4 w-4' />
            Select Folder
          </Button>
        </div>

        {/* Remote Path */}
        <div>
          <Label htmlFor='remote-path'>Destination Path (optional)</Label>
          <Input
            id='remote-path'
            placeholder='e.g., /models or leave empty for root'
            value={remotePath}
            onChange={(e) => setRemotePath(e.target.value)}
            className='mt-1'
            disabled={isUploading}
          />
        </div>

        {/* Settings */}
        <div className='flex flex-wrap items-center gap-4'>
          <div className='flex items-center gap-2'>
            <Label htmlFor='concurrency'>Concurrency:</Label>
            <select
              id='concurrency'
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className='h-9 rounded-md border border-input bg-background px-3 text-sm'
              disabled={isUploading}
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Badge variant='outline' className='bg-blue-50'>
              {pendingCount} pending
            </Badge>
            {completedCount > 0 && (
              <Badge variant='outline' className='bg-green-50'>
                {completedCount} done
              </Badge>
            )}
            {errorCount > 0 && (
              <Badge variant='outline' className='bg-red-50'>
                {errorCount} failed
              </Badge>
            )}
            {uploadingCount > 0 && (
              <Badge variant='outline' className='bg-yellow-50'>
                {uploadingCount} uploading
              </Badge>
            )}
          </div>
        </div>

        {/* Overall Progress */}
        {isUploading && (
          <div className='space-y-1'>
            <div className='flex justify-between text-sm'>
              <span>Overall Progress</span>
              <span>{totalProgress}%</span>
            </div>
            <Progress value={totalProgress} className='h-2' />
          </div>
        )}

        {/* File List */}
        {files.length > 0 && (
          <div className='max-h-80 overflow-y-auto rounded-md border'>
            {files.map((file) => (
              <div
                key={file.id}
                className='flex items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted/50'
              >
                <div className='flex-shrink-0'>
                  {file.status === 'completed' && (
                    <CheckCircle2 className='h-5 w-5 text-green-500' />
                  )}
                  {file.status === 'error' && (
                    <XCircle className='h-5 w-5 text-red-500' />
                  )}
                  {file.status === 'uploading' && (
                    <Loader2 className='h-5 w-5 animate-spin text-blue-500' />
                  )}
                  {file.status === 'pending' && (
                    <FileIcon className='h-5 w-5 text-muted-foreground' />
                  )}
                </div>
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium'>{file.name}</p>
                  <p className='truncate text-xs text-muted-foreground'>
                    {file.localPath}
                  </p>
                  {file.error && (
                    <p className='truncate text-xs text-red-500'>
                      {file.error}
                    </p>
                  )}
                </div>
                <div className='w-24 flex-shrink-0'>
                  {file.status === 'uploading' && (
                    <Progress value={file.progress} className='h-2' />
                  )}
                  {file.status === 'completed' && (
                    <span className='text-sm text-green-500'>
                      {file.progress}%
                    </span>
                  )}
                  {file.status === 'error' && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => handleRetryError(file.id)}
                    >
                      Retry
                    </Button>
                  )}
                </div>
                {!isUploading && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    onClick={() => handleRemoveFile(file.id)}
                  >
                    <X className='h-4 w-4' />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className='flex gap-2'>
          <Button
            onClick={handleUpload}
            disabled={isUploading || pendingCount === 0}
            className='flex-1'
          >
            {isUploading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Uploading...
              </>
            ) : (
              <>
                <Play className='mr-2 h-4 w-4' />
                Upload {pendingCount > 0 && `(${pendingCount})`}
              </>
            )}
          </Button>
          {completedCount > 0 && !isUploading && (
            <Button variant='outline' onClick={handleClearCompleted}>
              Clear Done
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
