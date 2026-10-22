import { useState } from 'react'
import { FolderOpen, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  useCreateKaggleDataset,
  useCreateKaggleDatasetVersion,
} from '@/hooks/use-kaggle'
import type { KaggleDataset } from '@/lib/kaggle-types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const LICENSES = [
  'CC0-1.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-SA-4.0',
  'ODC-BY-1.0',
  'MIT',
  'Apache-2.0',
  'GPL-3.0',
  'other',
]

const DATASET_TITLE_HINT = '6-50 characters'

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'dataset'
}

type UploadDatasetDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string | null
  datasets: KaggleDataset[]
  onUploaded: () => void
}

export function UploadDatasetDialog({
  open,
  onOpenChange,
  accountId,
  datasets,
  onUploaded,
}: UploadDatasetDialogProps) {
  const createDataset = useCreateKaggleDataset()
  const createVersion = useCreateKaggleDatasetVersion()

  const [mode, setMode] = useState<'new' | 'version'>('new')

  // New dataset
  const [folder, setFolder] = useState('')
  const [title, setTitle] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugDraft, setSlugDraft] = useState('')
  const slug = slugTouched ? slugDraft : slugify(title)
  const [license, setLicense] = useState('CC0-1.0')
  const [isPublic, setIsPublic] = useState(false)

  // New version
  const [datasetRef, setDatasetRef] = useState('')
  const [versionFolder, setVersionFolder] = useState('')
  const [notes, setNotes] = useState('')

  const [error, setError] = useState('')

  const isPending = createDataset.isPending || createVersion.isPending

  const chooseFolder = async (target: 'new' | 'version') => {
    const picked = await openDialog({
      multiple: false,
      directory: true,
      title: 'Choose folder with dataset files',
    })
    if (typeof picked === 'string') {
      if (target === 'new') setFolder(picked)
      else setVersionFolder(picked)
    }
  }

  const resetAndClose = () => {
    setFolder('')
    setTitle('')
    setSlugDraft('')
    setSlugTouched(false)
    setIsPublic(false)
    setDatasetRef('')
    setVersionFolder('')
    setNotes('')
    setError('')
    onOpenChange(false)
  }

  const handleUpload = async () => {
    setError('')
    if (!accountId) {
      setError('Select a Kaggle account first')
      return
    }
    try {
      if (mode === 'new') {
        if (!folder.trim()) {
          setError('Choose a local folder containing the data files')
          return
        }
        const finalTitle = title.trim()
        if (finalTitle.length < 6 || finalTitle.length > 50) {
          setError('Title must be 6-50 characters')
          return
        }
        const finalSlug = slugify(slug)
        if (finalSlug.length < 6 || finalSlug.length > 50) {
          setError('Slug must be 6-50 characters (flatten out of the title)')
          return
        }
        const message = await createDataset.mutateAsync({
          accountId,
          folder: folder.trim(),
          title: finalTitle,
          slug: finalSlug,
          license,
          isPublic,
        })
        toast.success(message || 'Dataset created & files uploaded')
      } else {
        if (!datasetRef) {
          setError('Select the dataset to update')
          return
        }
        if (!versionFolder.trim()) {
          setError('Choose the folder containing updated files')
          return
        }
        if (!notes.trim()) {
          setError('Version notes are required')
          return
        }
        const message = await createVersion.mutateAsync({
          accountId,
          folder: versionFolder.trim(),
          dataset: datasetRef,
          notes: notes.trim(),
        })
        toast.success(message || 'Version uploaded')
      }
      onUploaded()
      resetAndClose()
    } catch (e) {
      setError(String(e))
    }
  }

  const folderPicker = (target: 'new' | 'version') => {
    const value = target === 'new' ? folder : versionFolder
    return (
      <div className='grid gap-2'>
        <Label>Files folder</Label>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => void chooseFolder(target)} disabled={isPending}>
            <FolderOpen className='mr-2 h-4 w-4' />
            Browse…
          </Button>
          <span
            className='flex min-w-0 flex-1 items-center truncate rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground'
            title={value}
          >
            {value || 'No folder selected'}
          </span>
        </div>
        <span className='text-[10px] text-muted-foreground'>
          All files are uploaded; subfolders are skipped (flatten your data files).
        </span>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>Upload Dataset</DialogTitle>
          <DialogDescription>
            App writes <code>dataset-metadata.json</code> and uploads the folder via
            <code> kaggle datasets {"{"}create,version{"}"}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 py-1'>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as 'new' | 'version')}
            className='grid grid-cols-2 gap-2'
            disabled={isPending}
          >
            <Label
              htmlFor='mode-new'
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                mode === 'new' ? 'border-primary bg-primary/5' : ''
              }`}
            >
              <RadioGroupItem value='new' id='mode-new' className='mt-0.5' />
              <div>
                <span className='block text-sm font-medium leading-none'>New dataset</span>
                <span className='mt-1 block text-xs text-muted-foreground'>
                  First upload
                </span>
              </div>
            </Label>
            <Label
              htmlFor='mode-version'
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                mode === 'version' ? 'border-primary bg-primary/5' : ''
              }`}
            >
              <RadioGroupItem value='version' id='mode-version' className='mt-0.5' />
              <div>
                <span className='block text-sm font-medium leading-none'>New version</span>
                <span className='mt-1 block text-xs text-muted-foreground'>
                  Update existing files
                </span>
              </div>
            </Label>
          </RadioGroup>

          {mode === 'new' ? (
            <>
              {folderPicker('new')}

              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='grid gap-2'>
                  <Label htmlFor='dataset-title'>Title ({DATASET_TITLE_HINT})</Label>
                  <Input
                    id='dataset-title'
                    placeholder='Train data v1'
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isPending}
                  />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='dataset-slug'>Slug ({DATASET_TITLE_HINT})</Label>
                  <Input
                    id='dataset-slug'
                    placeholder='train-data-v1'
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      setSlugDraft(e.target.value)
                    }}
                    disabled={isPending}
                    autoComplete='off'
                  />
                </div>
              </div>

              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='grid gap-2'>
                  <Label>License</Label>
                  <Select value={license} onValueChange={setLicense} disabled={isPending}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LICENSES.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='flex items-center justify-between rounded-lg border px-3 py-2'>
                  <Label htmlFor='dataset-public' className='cursor-pointer text-sm font-normal'>
                    Public
                  </Label>
                  <Switch
                    id='dataset-public'
                    checked={isPublic}
                    onCheckedChange={setIsPublic}
                    disabled={isPending}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className='grid gap-2'>
                <Label>Dataset to update</Label>
                <Select value={datasetRef} onValueChange={setDatasetRef} disabled={isPending}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select dataset' />
                  </SelectTrigger>
                  <SelectContent>
                    {datasets.map((d) => (
                      <SelectItem key={d.ref} value={d.ref}>
                        {d.title || d.ref}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {folderPicker('version')}

              <div className='grid gap-2'>
                <Label htmlFor='dataset-notes'>Version notes</Label>
                <Textarea
                  id='dataset-notes'
                  placeholder='What changed in this version…'
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isPending}
                  className='min-h-[64px]'
                />
              </div>
            </>
          )}

          {error && (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-all'>
              {error}
            </div>
          )}
        </div>

        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={resetAndClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={isPending}>
            {isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Upload className='mr-2 h-4 w-4' />
            )}
            {isPending
              ? 'Uploading…'
              : mode === 'new'
                ? 'Create & Upload'
                : 'Upload Version'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
