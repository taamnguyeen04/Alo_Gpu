import { useState } from 'react'
import { Lock, Plus, Trash2, RefreshCw, Key, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SecretKeyValue } from '@/lib/modal-types'
import {
  useCurrentProfile,
  useSecrets,
  useCreateSecret,
  useDeleteSecret,
} from '@/hooks/use-modal'
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
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function SecretsPage() {
  const { data: currentProfile } = useCurrentProfile()
  const {
    data: secrets,
    isLoading,
    refetch,
  } = useSecrets(currentProfile || undefined)
  const createSecret = useCreateSecret()
  const deleteSecret = useDeleteSecret()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [newSecretName, setNewSecretName] = useState('')
  const [newKeyvalues, setNewKeyvalues] = useState<SecretKeyValue[]>([
    { key: '', value: '' },
  ])

  const handleAddKeyvalue = () => {
    setNewKeyvalues([...newKeyvalues, { key: '', value: '' }])
  }

  const handleRemoveKeyvalue = (index: number) => {
    setNewKeyvalues(newKeyvalues.filter((_, i) => i !== index))
  }

  const handleKeyvalueChange = (
    index: number,
    field: 'key' | 'value',
    value: string
  ) => {
    const updated = [...newKeyvalues]
    updated[index][field] = value
    setNewKeyvalues(updated)
  }

  const handleCreateSecret = async () => {
    if (!newSecretName.trim()) {
      toast.error('Secret name is required')
      return
    }

    const validKeyvalues = newKeyvalues.filter(
      (kv) => kv.key.trim() && kv.value.trim()
    )
    if (validKeyvalues.length === 0) {
      toast.error('At least one key-value pair is required')
      return
    }

    try {
      await createSecret.mutateAsync({
        name: newSecretName.trim(),
        keyvalues: validKeyvalues,
      })
      toast.success(`Secret "${newSecretName}" created successfully`)
      setIsCreateOpen(false)
      setNewSecretName('')
      setNewKeyvalues([{ key: '', value: '' }])
      refetch()
    } catch (error) {
      toast.error(`Failed to create secret: ${error}`)
    }
  }

  const handleDeleteSecret = async () => {
    if (!deleteTarget) return

    try {
      await deleteSecret.mutateAsync(deleteTarget)
      toast.success(`Secret "${deleteTarget}" deleted`)
      setDeleteTarget(null)
      refetch()
    } catch (error) {
      toast.error(`Failed to delete secret: ${error}`)
    }
  }

  return (
    <>
      <div className='mb-6 flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Secrets</h1>
          <p className='text-muted-foreground'>
            Manage your Modal secrets and environment variables
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            <RefreshCw className='mr-2 h-4 w-4' />
            Refresh
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size='sm'>
                <Plus className='mr-2 h-4 w-4' />
                Create Secret
              </Button>
            </DialogTrigger>
            <DialogContent className='max-w-lg'>
              <DialogHeader>
                <DialogTitle>Create New Secret</DialogTitle>
              </DialogHeader>
              <div className='space-y-4 pt-4'>
                <div>
                  <label className='text-sm font-medium'>Secret Name</label>
                  <Input
                    placeholder='e.g., API_KEYS'
                    value={newSecretName}
                    onChange={(e) => setNewSecretName(e.target.value)}
                    className='mt-1'
                  />
                </div>

                <div>
                  <label className='text-sm font-medium'>Key-Value Pairs</label>
                  <div className='mt-1 space-y-2'>
                    {newKeyvalues.map((kv, index) => (
                      <div key={index} className='flex gap-2'>
                        <Input
                          placeholder='Key (e.g., OPENAI_API_KEY)'
                          value={kv.key}
                          onChange={(e) =>
                            handleKeyvalueChange(index, 'key', e.target.value)
                          }
                          className='flex-1'
                        />
                        <Input
                          placeholder='Value'
                          value={kv.value}
                          onChange={(e) =>
                            handleKeyvalueChange(index, 'value', e.target.value)
                          }
                          className='flex-1'
                          type='password'
                        />
                        {newKeyvalues.length > 1 && (
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => handleRemoveKeyvalue(index)}
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleAddKeyvalue}
                    className='mt-2'
                  >
                    <Plus className='mr-2 h-4 w-4' />
                    Add Key-Value
                  </Button>
                </div>

                <div className='flex justify-end gap-2'>
                  <Button
                    variant='outline'
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateSecret}
                    disabled={createSecret.isPending}
                  >
                    {createSecret.isPending ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Creating...
                      </>
                    ) : (
                      'Create Secret'
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className='space-y-4'>
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className='h-16 w-full' />
          ))}
        </div>
      )}

      {/* Secrets Table */}
      {!isLoading && secrets && (
        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-12'>Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((secret) => (
                  <TableRow key={secret.name}>
                    <TableCell>
                      <Key className='h-4 w-4 text-muted-foreground' />
                    </TableCell>
                    <TableCell className='font-medium'>{secret.name}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {secret.created_at || '-'}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8 text-destructive hover:text-destructive'
                        onClick={() => setDeleteTarget(secret.name)}
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && secrets?.length === 0 && (
        <Card>
          <CardContent className='flex flex-col items-center justify-center py-12'>
            <Lock className='mb-4 h-12 w-12 text-muted-foreground' />
            <h3 className='mb-2 text-lg font-semibold'>No secrets found</h3>
            <p className='mb-4 text-center text-muted-foreground'>
              Create your first secret to store environment variables.
            </p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className='mr-2 h-4 w-4' />
              Create Secret
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Secret</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete secret "{deleteTarget}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSecret}
              className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
            >
              {deleteSecret.isPending ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
