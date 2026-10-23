import { useMemo, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Loader2, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import type { KaggleRunProjectResult } from '@/lib/kaggle-types'
import { useKaggleProjectScan, useRunKaggleProject } from '@/hooks/use-kaggle'
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

const PREFERRED_ENTRYPOINTS = ['main.py', 'train.py', 'app.py', 'run.py']

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'alo-run'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function splitCsv(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

type RunProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string | null
  onRunSuccess: (result: KaggleRunProjectResult) => void
}

export function RunProjectDialog({
  open,
  onOpenChange,
  accountId,
  onRunSuccess,
}: RunProjectDialogProps) {
  const run = useRunKaggleProject()

  const [folder, setFolder] = useState('')
  const [entryDraft, setEntryDraft] = useState('')
  const [entryTouched, setEntryTouched] = useState(false)
  const [moduleMode, setModuleMode] = useState(false)
  const [moduleName, setModuleName] = useState('')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [slugDraft, setSlugDraft] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [accelerator, setAccelerator] = useState('NvidiaTeslaT4')
  const [enableInternet, setEnableInternet] = useState(true)
  const [runNow, setRunNow] = useState(true)
  const [requirementsManual, setRequirementsManual] = useState<string | null>(
    null
  )
  const [extraPackages, setExtraPackages] = useState('')
  const [datasetSources, setDatasetSources] = useState('')
  const [secrets, setSecrets] = useState('')
  const [scriptArgs, setScriptArgs] = useState('')
  const [outputPaths, setOutputPaths] = useState('outputs')
  const [error, setError] = useState('')

  const projectRoot = folder.trim() || undefined
  const { data: scan } = useKaggleProjectScan(open ? projectRoot : undefined)

  // Default entrypoint: scan order with common names first, until user touches it
  const defaultEntry = useMemo(() => {
    const list = scan?.entrypoints || []
    const lower = list.map((e) => e.toLowerCase())
    for (const pref of PREFERRED_ENTRYPOINTS) {
      const idx = lower.indexOf(pref)
      if (idx !== -1) return list[idx]
    }
    return list[0] ?? ''
  }, [scan?.entrypoints])
  const entrypoint = entryTouched ? entryDraft : defaultEntry

  // Default title/slug from folder name until touched
  const folderName = projectRoot
    ? (projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? '')
    : ''
  const effectiveTitle = titleTouched ? title : folderName
  const slug = slugTouched ? slugDraft : slugify(effectiveTitle || folderName)

  // Script/module mode binding
  const moduleActive = moduleMode && moduleName.trim() !== ''
  const effectiveRequirements = (() => {
    if (requirementsManual !== null) return requirementsManual
    if (scan?.requirements) return scan.requirements
    if (scan?.pyproject) return scan.pyproject
    return ''
  })()

  const chooseFolder = async () => {
    const picked = await openDialog({
      multiple: false,
      directory: true,
      title: 'Choose your Python project root',
    })
    if (typeof picked === 'string') {
      setFolder(picked)
      setTitleTouched(false)
      setSlugTouched(false)
      setEntryTouched(false)
    }
  }

  const resetAndClose = () => {
    setFolder('')
    setEntryDraft('')
    setEntryTouched(false)
    setModuleMode(false)
    setModuleName('')
    setTitle('')
    setTitleTouched(false)
    setSlugDraft('')
    setSlugTouched(false)
    setAccelerator('NvidiaTeslaT4')
    setEnableInternet(true)
    setRunNow(true)
    setRequirementsManual(null)
    setExtraPackages('')
    setDatasetSources('')
    setSecrets('')
    setScriptArgs('')
    setOutputPaths('outputs')
    setError('')
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    setError('')
    if (!accountId) {
      setError('Select a Kaggle account first')
      return
    }
    if (!projectRoot) {
      setError('Choose the project root folder')
      return
    }
    if (moduleActive) {
      if (!moduleName.trim()) {
        setError('Enter the module name (e.g. my_pkg or my_pkg.main)')
        return
      }
    } else if (!entrypoint) {
      setError(
        'No .py file found in the project — pick an entrypoint or use module mode'
      )
      return
    }
    if (effectiveTitle.trim().length < 5) {
      setError('Title must be at least 5 characters')
      return
    }
    const finalSlug = slugify(slug)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(finalSlug)) {
      setError('Slug may only contain lowercase letters, numbers and dashes')
      return
    }
    if (splitCsv(extraPackages).length > 0 && !enableInternet) {
      setError('Internet is OFF but extra packages were declared')
      return
    }

    try {
      const result = await run.mutateAsync({
        accountId,
        projectRoot: projectRoot,
        config: {
          title: effectiveTitle.trim(),
          slug: finalSlug,
          entrypoint: moduleActive ? '' : entrypoint,
          module: moduleActive ? moduleName.trim() : '',
          requirements: effectiveRequirements,
          extra_packages: splitCsv(extraPackages),
          dataset_sources: splitCsv(datasetSources),
          secrets: splitCsv(secrets),
          args: scriptArgs.trim().split(/\s+/).filter(Boolean),
          output_paths: splitCsv(outputPaths).length
            ? splitCsv(outputPaths)
            : ['outputs'],
          accelerator,
          enable_internet: enableInternet,
          no_run: !runNow,
        },
      })
      toast.success(`Submitted ${result.kernel} (${result.transport})`, {
        description: result.message || 'Check logs in the kernel viewer',
      })
      onRunSuccess(result)
      resetAndClose()
    } catch (e) {
      setError(String(e))
    }
  }

  const isPending = run.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>Run Project (modal-run style)</DialogTitle>
          <DialogDescription>
            App packages the whole folder into a generated runner and pushes it
            as a private kernel — dependencies install on Kaggle, logs &amp;
            output land in the kernel viewer.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 py-1'>
          {/* Folder */}
          <div className='grid gap-2'>
            <Label>Project root</Label>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                onClick={() => void chooseFolder()}
                disabled={isPending}
              >
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
            {scan && !scan.over_limit && (
              <span className='text-xs text-muted-foreground'>
                {scan.file_count} files • {formatBytes(scan.total_bytes)} to
                upload
              </span>
            )}
            {scan?.warnings.map((w) => (
              <span key={w} className='text-xs break-all text-amber-600'>
                ⚠ {w}
              </span>
            ))}
          </div>

          {/* Entrypoint / module */}
          {!moduleActive && (
            <div className='grid gap-2'>
              <Label>Entrypoint (.py)</Label>
              {scan && scan.entrypoints.length > 0 ? (
                <Select
                  value={entrypoint}
                  onValueChange={(v) => {
                    setEntryTouched(true)
                    setEntryDraft(v)
                  }}
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select file' />
                  </SelectTrigger>
                  <SelectContent>
                    {scan.entrypoints.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className='text-xs text-muted-foreground'>
                  {scan ? 'No .py found in this project.' : 'Scanning…'}
                </span>
              )}
            </div>
          )}
          <div className='grid gap-2'>
            <div className='flex items-center justify-between rounded-lg border px-3 py-2'>
              <Label
                htmlFor='alorun-module-mode'
                className='cursor-pointer text-sm font-normal'
              >
                Run as module (-m)
              </Label>
              <Switch
                id='alorun-module-mode'
                checked={moduleMode}
                onCheckedChange={setModuleMode}
                disabled={isPending}
              />
            </div>
            {moduleMode && (
              <Input
                placeholder='my_pkg or my_pkg.main (root or src/ layout)'
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                disabled={isPending}
                autoComplete='off'
              />
            )}
          </div>

          {/* Title + slug */}
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='alorun-title'>Title</Label>
              <Input
                id='alorun-title'
                placeholder='Train my model'
                value={effectiveTitle}
                onChange={(e) => {
                  setTitleTouched(true)
                  setTitle(e.target.value)
                }}
                disabled={isPending}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='alorun-slug'>Slug</Label>
              <Input
                id='alorun-slug'
                placeholder='train-my-model'
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

          {/* Accelerator */}
          <div className='grid gap-2'>
            <Label>Accelerator</Label>
            <Select
              value={accelerator}
              onValueChange={setAccelerator}
              disabled={isPending}
            >
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

          {/* Dependencies */}
          <div className='grid gap-2'>
            <Label>Dependency file</Label>
            <Select
              value={effectiveRequirements || 'none'}
              onValueChange={(v) =>
                setRequirementsManual(v === 'none' ? '' : v)
              }
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='none'>None — no auto install</SelectItem>
                {scan?.requirements ? (
                  <SelectItem value={scan.requirements}>
                    {scan.requirements} (pip install -r)
                  </SelectItem>
                ) : null}
                {scan?.pyproject ? (
                  <SelectItem value={scan.pyproject}>
                    {scan.pyproject} (pip install folder)
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Input
              id='alorun-extras'
              placeholder='Extra pip packages (optional): torch==2.1.0, einops'
              value={extraPackages}
              onChange={(e) => setExtraPackages(e.target.value)}
              disabled={isPending}
              autoComplete='off'
            />
          </div>

          {/* Data sources */}
          <div className='grid gap-2'>
            <Label htmlFor='alorun-datasets'>
              Kaggle datasets to attach (optional)
            </Label>
            <Input
              id='alorun-datasets'
              placeholder='username/dataset-slug, username/other'
              value={datasetSources}
              onChange={(e) => setDatasetSources(e.target.value)}
              disabled={isPending}
              autoComplete='off'
            />
          </div>
          <div className='grid gap-2 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='alorun-secrets'>Kaggle secrets (optional)</Label>
              <Input
                id='alorun-secrets'
                placeholder='API_KEY, DB_URL'
                value={secrets}
                onChange={(e) => setSecrets(e.target.value)}
                disabled={isPending}
                autoComplete='off'
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='alorun-args'>Script args (space separated)</Label>
              <Input
                id='alorun-args'
                placeholder='--epochs 10 --lr 3e-4'
                value={scriptArgs}
                onChange={(e) => setScriptArgs(e.target.value)}
                disabled={isPending}
                autoComplete='off'
              />
            </div>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='alorun-outputs'>Output folders to collect</Label>
            <Input
              id='alorun-outputs'
              placeholder='outputs'
              value={outputPaths}
              onChange={(e) => setOutputPaths(e.target.value)}
              disabled={isPending}
              autoComplete='off'
            />
            <span className='text-xs text-muted-foreground'>
              Files your script writes here are copied to the kernel output so
              you can download them afterwards.
            </span>
          </div>

          {/* Toggles */}
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='flex items-center justify-between rounded-lg border px-3 py-2'>
              <Label
                htmlFor='alorun-internet'
                className='cursor-pointer text-sm font-normal'
              >
                Internet
              </Label>
              <Switch
                id='alorun-internet'
                checked={enableInternet}
                onCheckedChange={setEnableInternet}
                disabled={isPending}
              />
            </div>
            <div className='flex items-center justify-between rounded-lg border px-3 py-2'>
              <Label
                htmlFor='alorun-runnow'
                className='cursor-pointer text-sm font-normal'
              >
                Run immediately
              </Label>
              <Checkbox
                id='alorun-runnow'
                checked={runNow}
                onCheckedChange={(v) => setRunNow(!!v)}
                disabled={isPending}
              />
            </div>
          </div>

          {error && (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs break-all text-destructive'>
              {error}
            </div>
          )}
        </div>

        <div className='flex justify-end gap-2'>
          <Button
            variant='outline'
            onClick={resetAndClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              isPending ||
              !accountId ||
              !projectRoot ||
              (!moduleActive && !entrypoint) ||
              effectiveTitle.trim().length < 5
            }
          >
            {isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Rocket className='mr-2 h-4 w-4' />
            )}
            {isPending ? 'Packaging & pushing…' : 'Chạy trên Kaggle'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
