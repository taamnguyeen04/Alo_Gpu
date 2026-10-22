import { useMemo, useState } from 'react'
import { FolderOpen, Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  useKaggleFolderFiles,
  usePushKaggleKernel,
} from '@/hooks/use-kaggle'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const ACCELERATORS = [
  { value: 'NvidiaTeslaT4', label: 'GPU T4 x2 — default' },
  { value: 'NvidiaL4', label: 'GPU L4 x4' },
  { value: 'NvidiaL4X1', label: 'GPU L4 x1' },
  { value: 'NvidiaTeslaA100', label: 'GPU A100 80GB' },
  { value: 'NvidiaH100', label: 'GPU H100 80GB' },
  { value: 'NvidiaRtxPro6000', label: 'GPU RTX Pro 6000' },
  { value: 'TpuV5E8', label: 'TPU v5e-8' },
  { value: '', label: 'CPU only' },
]

const CODE_EXTENSIONS = ['.ipynb', '.py', '.R', '.Rmd', '.sql', '.jl']

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'kernel'
}

type NewRunDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string | null
  onPushed: () => void
}

export function NewRunDialog({
  open,
  onOpenChange,
  accountId,
  onPushed,
}: NewRunDialogProps) {
  const push = usePushKaggleKernel()

  const [folder, setFolder] = useState('')
  const [title, setTitle] = useState('')
  // Derived slug: auto-generates from the title until the user edits it manually
  const [slugDraft, setSlugDraft] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const slug = slugTouched ? slugDraft : slugify(title)
  const [languageManual, setLanguageManual] = useState<'python' | 'r' | null>(null)
  const [kernelTypeManual, setKernelTypeManual] = useState<'notebook' | 'script' | null>(null)
  const [accelerator, setAccelerator] = useState('NvidiaTeslaT4')
  const [isPrivate, setIsPrivate] = useState(true)
  const [enableInternet, setEnableInternet] = useState(true)
  const [datasetSources, setDatasetSources] = useState('')
  const [kernelSources, setKernelSources] = useState('')
  const [runNow, setRunNow] = useState(true)
  const [error, setError] = useState('')

  // List local files to choose the code file
  const { data: folderFiles } = useKaggleFolderFiles(folder || undefined)
  const codeFiles = useMemo(
    () => (folderFiles || []).filter((f) => CODE_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext.toLowerCase()))),
    [folderFiles]
  )
  const [codeSelection, setCodeSelection] = useState('')
  const selectedCodeFile =
    codeFiles.length > 0 && codeFiles.includes(codeSelection)
      ? codeSelection
      : (codeFiles.find((f) => f.toLowerCase().endsWith('.ipynb')) ?? codeFiles[0] ?? '')
  // Infer language/type from the selected file extension unless the user overrides them
  const inferredLanguage: 'python' | 'r' = /\.(r|rmd)$/i.test(selectedCodeFile) ? 'r' : 'python'
  const language = languageManual ?? inferredLanguage
  const inferredKernelType: 'notebook' | 'script' = selectedCodeFile
    .toLowerCase()
    .endsWith('.ipynb')
    ? 'notebook'
    : 'script'
  const kernelType = kernelTypeManual ?? inferredKernelType

  const chooseFolder = async () => {
    const picked = await openDialog({
      multiple: false,
      directory: true,
      title: 'Choose folder with notebook/script',
    })
    if (typeof picked === 'string') {
      setFolder(picked)
    }
  }

  const resetAndClose = () => {
    setFolder('')
    setTitle('')
    setSlugDraft('')
    setSlugTouched(false)
    setLanguageManual(null)
    setKernelTypeManual(null)
    setAccelerator('NvidiaTeslaT4')
    setIsPrivate(true)
    setEnableInternet(true)
    setDatasetSources('')
    setKernelSources('')
    setRunNow(true)
    setError('')
    onOpenChange(false)
  }

  const handlePush = async () => {
    setError('')
    if (!accountId) {
      setError('Select a Kaggle account first')
      return
    }
    if (!folder.trim()) {
      setError('Choose a local folder containing your notebook/script')
      return
    }
    if (!selectedCodeFile) {
      setError('No notebook/script file found in the folder (.ipynb, .py, ...)')
      return
    }
    if (title.trim().length < 5) {
      setError('Title must be at least 5 characters')
      return
    }
    const finalSlug = slugify(slug)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(finalSlug)) {
      setError('Slug may only contain lowercase letters, numbers and dashes')
      return
    }

    try {
      const message = await push.mutateAsync({
        accountId,
        folder: folder.trim(),
        config: {
          title: title.trim(),
          slug: finalSlug,
          language,
          kernel_type: kernelType,
          accelerator,
          is_private: isPrivate,
          enable_internet: enableInternet,
          code_file: selectedCodeFile,
          dataset_sources: datasetSources
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          kernel_sources: kernelSources
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        noRun: !runNow,
      })
      toast.success(message || 'Kernel pushed')
      onPushed()
      resetAndClose()
    } catch (e) {
      setError(String(e))
    }
  }

  const isPending = push.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>New Run</DialogTitle>
          <DialogDescription>
            App writes <code>kernel-metadata.json</code> into the chosen folder and
            pushes to Kaggle — it runs on the selected accelerator.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 py-1'>
          {/* Folder */}
          <div className='grid gap-2'>
            <Label>Code folder</Label>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={() => void chooseFolder()} disabled={isPending}>
                <FolderOpen className='mr-2 h-4 w-4' />
                Browse…
              </Button>
              <span
                className='flex min-w-0 flex-1 items-center truncate rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground'
                title={folder}
              >
                {folder || 'No folder selected'}
              </span>
            </div>
          </div>

          {/* Code file */}
          {folder ? (
            <div className='grid gap-2'>
              <Label>Code file</Label>
              {codeFiles.length > 0 ? (
                <Select
                  value={selectedCodeFile}
                  onValueChange={setCodeSelection}
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select file' />
                  </SelectTrigger>
                  <SelectContent>
                    {codeFiles.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className='text-xs text-muted-foreground'>
                  No .ipynb/.py file found yet in this folder.
                </span>
              )}
            </div>
          ) : null}

          {/* Title + slug */}
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='kernel-title'>Title</Label>
              <Input
                id='kernel-title'
                placeholder='Train my model v1'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='kernel-slug'>Slug</Label>
              <Input
                id='kernel-slug'
                placeholder='train-my-model-v1'
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

          {/* Language / type / accelerator */}
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='grid gap-2'>
              <Label>Type</Label>
              <Select
                value={kernelType}
                onValueChange={(v) => setKernelTypeManual(v as 'notebook' | 'script')}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='notebook'>Notebook</SelectItem>
                  <SelectItem value='script'>Script</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Language</Label>
              <Select
                value={language}
                onValueChange={(v) => setLanguageManual(v as 'python' | 'r')}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='python'>Python</SelectItem>
                  <SelectItem value='r'>R</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Accelerator</Label>
              <Select value={accelerator} onValueChange={setAccelerator} disabled={isPending}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCELERATORS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Options */}
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='flex items-center justify-between rounded-lg border px-3 py-2'>
              <Label htmlFor='kernel-private' className='cursor-pointer text-sm font-normal'>
                Private
              </Label>
              <Switch
                id='kernel-private'
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
                disabled={isPending}
              />
            </div>
            <div className='flex items-center justify-between rounded-lg border px-3 py-2'>
              <Label htmlFor='kernel-internet' className='cursor-pointer text-sm font-normal'>
                Internet
              </Label>
              <Switch
                id='kernel-internet'
                checked={enableInternet}
                onCheckedChange={setEnableInternet}
                disabled={isPending}
              />
            </div>
            <div className='flex items-center justify-between rounded-lg border px-3 py-2'>
              <Label htmlFor='kernel-runnnow' className='cursor-pointer text-sm font-normal'>
                Run immediately
              </Label>
              <Checkbox
                id='kernel-runnnow'
                checked={runNow}
                onCheckedChange={(v) => setRunNow(!!v)}
                disabled={isPending}
              />
            </div>
          </div>

          {/* Sources */}
          <div className='grid gap-2'>
            <Label htmlFor='kernel-datasets'>Dataset sources (optional)</Label>
            <Input
              id='kernel-datasets'
              placeholder='username/dataset-slug, username/other-dataset'
              value={datasetSources}
              onChange={(e) => setDatasetSources(e.target.value)}
              disabled={isPending}
              autoComplete='off'
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='kernel-src'>Kernel sources (optional)</Label>
            <Input
              id='kernel-src'
              placeholder='username/kernel-slug'
              value={kernelSources}
              onChange={(e) => setKernelSources(e.target.value)}
              disabled={isPending}
              autoComplete='off'
            />
          </div>

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
          <Button
            onClick={handlePush}
            disabled={
              isPending ||
              !accountId ||
              !folder ||
              !selectedCodeFile ||
              title.trim().length < 5
            }
          >
            {isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Play className='mr-2 h-4 w-4' />
            )}
            {isPending ? 'Pushing…' : runNow ? 'Push & Run' : 'Quick Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
