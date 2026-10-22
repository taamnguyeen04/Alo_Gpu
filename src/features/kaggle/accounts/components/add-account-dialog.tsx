import { useState } from 'react'
import { ExternalLink, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  useAddKaggleAccount,
  useAddKaggleTokenAccount,
} from '@/hooks/use-kaggle'
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

const SETTINGS_API_URL = 'https://www.kaggle.com/settings/api'

type AddAccountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddAccountDialog({ open, onOpenChange }: AddAccountDialogProps) {
  const addAccount = useAddKaggleAccount()
  const addTokenAccount = useAddKaggleTokenAccount()

  const [mode, setMode] = useState<'legacy_key' | 'api_token'>('legacy_key')
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [key, setKey] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  const isPending = addAccount.isPending || addTokenAccount.isPending
  const canSave =
    (mode === 'legacy_key' && label.trim() && username.trim() && key.trim()) ||
    (mode === 'api_token' && label.trim() && token.trim())

  const resetAndClose = () => {
    setLabel('')
    setUsername('')
    setKey('')
    setToken('')
    setError('')
    setMode('legacy_key')
    onOpenChange(false)
  }

  const handleSave = async () => {
    setError('')
    try {
      if (mode === 'legacy_key') {
        const account = await addAccount.mutateAsync({
          label: label.trim(),
          username: username.trim(),
          key: key.trim(),
        })
        toast.success(`Account "${account.label}" verified & added`)
      } else {
        const account = await addTokenAccount.mutateAsync({
          label: label.trim(),
          token: token.trim(),
        })
        toast.success(
          account.username
            ? `Account "${account.label}" (${account.username}) verified & added`
            : `Account "${account.label}" verified & added`
        )
      }
      resetAndClose()
    } catch (e) {
      // Keep the dialog open so the user can fix the input
      setError(String(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>Add Kaggle Account</DialogTitle>
          <DialogDescription>
            The credentials are verified with a real API call before saving.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 py-2'>
          <div className='grid gap-2'>
            <Label htmlFor='kaggle-label'>Label</Label>
            <Input
              id='kaggle-label'
              placeholder='e.g. main, spare-1'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={isPending}
            />
          </div>

          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as 'legacy_key' | 'api_token')}
            className='grid grid-cols-2 gap-2'
            disabled={isPending}
          >
            <Label
              htmlFor='mode-legacy'
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                mode === 'legacy_key' ? 'border-primary bg-primary/5' : ''
              }`}
            >
              <RadioGroupItem value='legacy_key' id='mode-legacy' className='mt-0.5' />
              <div>
                <span className='block text-sm font-medium leading-none'>
                  Legacy API Key
                </span>
                <span className='mt-1 block text-xs text-muted-foreground'>
                  Username + key
                </span>
              </div>
            </Label>
            <Label
              htmlFor='mode-token'
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                mode === 'api_token' ? 'border-primary bg-primary/5' : ''
              }`}
            >
              <RadioGroupItem value='api_token' id='mode-token' className='mt-0.5' />
              <div>
                <span className='block text-sm font-medium leading-none'>API Token</span>
                <span className='mt-1 block text-xs text-muted-foreground'>
                  Token only
                </span>
              </div>
            </Label>
          </RadioGroup>

          {mode === 'legacy_key' ? (
            <>
              <div className='grid gap-2'>
                <Label htmlFor='kaggle-username'>Username</Label>
                <Input
                  id='kaggle-username'
                  placeholder='your-kaggle-username'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isPending}
                  autoComplete='off'
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='kaggle-key'>
                  API Key{' '}
                  <a
                    href={SETTINGS_API_URL}
                    target='_blank'
                    rel='noreferrer'
                    className='inline-flex items-center gap-0.5 text-xs text-primary hover:underline'
                  >
                    Get key <ExternalLink className='h-3 w-3' />
                  </a>
                </Label>
                <Input
                  id='kaggle-key'
                  type='password'
                  placeholder='{"username": ..., "key": ...} → the "key"'
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={isPending}
                  autoComplete='off'
                />
              </div>
            </>
          ) : (
            <div className='grid gap-2'>
              <Label htmlFor='kaggle-token'>
                API Token{' '}
                <a
                  href={SETTINGS_API_URL}
                  target='_blank'
                  rel='noreferrer'
                  className='inline-flex items-center gap-0.5 text-xs text-primary hover:underline'
                >
                  Generate token <ExternalLink className='h-3 w-3' />
                </a>
              </Label>
              <Input
                id='kaggle-token'
                type='password'
                placeholder='xxxxx (KAGGLE_API_TOKEN)'
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={isPending}
                autoComplete='off'
              />
              <span className='text-xs text-muted-foreground'>
                The username is resolved automatically from the token.
              </span>
            </div>
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
          <Button onClick={handleSave} disabled={!canSave || isPending}>
            {isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Plus className='mr-2 h-4 w-4' />
            )}
            {isPending ? 'Verifying...' : 'Verify & Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
