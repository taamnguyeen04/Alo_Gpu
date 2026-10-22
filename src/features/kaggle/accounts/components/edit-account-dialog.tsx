import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useUpdateKaggleAccount } from '@/hooks/use-kaggle'
import type { KaggleAccount } from '@/lib/kaggle-types'
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

type EditAccountDialogProps = {
  account: KaggleAccount | null
  onOpenChange: (open: boolean) => void
}

export function EditAccountDialog({
  account,
  onOpenChange,
}: EditAccountDialogProps) {
  const updateAccount = useUpdateKaggleAccount()
  const [label, setLabel] = useState(account?.label ?? '')

  // Sync local state with the account being edited
  const [editingId, setEditingId] = useState<string | null>(null)
  if (account && account.id !== editingId) {
    setEditingId(account.id)
    setLabel(account.label)
  }
  if (!account && editingId) {
    setEditingId(null)
  }

  const handleSave = async () => {
    if (!account) return
    try {
      await updateAccount.mutateAsync({ accountId: account.id, label: label.trim() })
      toast.success('Label updated')
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to update: ${error}`)
    }
  }

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[360px]'>
        <DialogHeader>
          <DialogTitle>Edit Label</DialogTitle>
          <DialogDescription>
            {account?.username ? `@${account.username}` : account?.id}
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-2 py-1'>
          <Label htmlFor='edit-label'>Label</Label>
          <Input
            id='edit-label'
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={updateAccount.isPending}
            autoComplete='off'
          />
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!label.trim() || updateAccount.isPending}
          >
            {updateAccount.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
