import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useKaggleStore } from '@/stores/kaggle-store'
import type { KaggleAccount, KaggleQuota } from '@/lib/kaggle-types'
import {
  useKaggleQuota,
  useRemoveKaggleAccount,
  useSetKaggleActiveAccount,
} from '@/hooks/use-kaggle'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

const AUTH_METHOD_LABEL: Record<KaggleAccount['auth_method'], string> = {
  legacy_key: 'Legacy Key',
  api_token: 'API Token',
  oauth: 'OAuth',
}

function quotaCacheKey(accountId: string) {
  return `kaggle_quota_${accountId}`
}

function readCachedQuota(
  accountId: string,
  cacheVersion: number
): KaggleQuota[] | null {
  try {
    const raw = localStorage.getItem(quotaCacheKey(accountId))
    if (raw) {
      void cacheVersion // recomputed when the cache is refreshed
      return JSON.parse(raw) as KaggleQuota[]
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('Corrupted quota cache:', error)
    }
  }
  return null
}

function remainingColorClass(remaining: number, total: number) {
  const totalSafe = total > 0 ? total : 1
  if (remaining <= totalSafe * 0.1) return 'text-red-500'
  if (remaining <= totalSafe * 0.2) return 'text-amber-500'
  return 'text-emerald-600 dark:text-emerald-400'
}

function barColorClass(remaining: number, total: number) {
  const totalSafe = total > 0 ? total : 1
  if (remaining <= totalSafe * 0.1) return '[&>div]:bg-red-500'
  if (remaining <= totalSafe * 0.2) return '[&>div]:bg-amber-500'
  return '[&>div]:bg-emerald-500'
}

function QuotaRow({ quota }: { quota: KaggleQuota }) {
  const usedPct =
    quota.total_hours > 0
      ? Math.min(100, (quota.used_hours / quota.total_hours) * 100)
      : 0

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-baseline justify-between text-xs'>
        <span className='font-medium'>{quota.resource}</span>
        <span
          className={remainingColorClass(
            quota.remaining_hours,
            quota.total_hours
          )}
        >
          {quota.remaining_hours.toFixed(1)}h left
          <span className='ml-1 text-muted-foreground'>
            / {quota.total_hours > 0 ? `${quota.total_hours.toFixed(0)}h` : '?'}
          </span>
        </span>
      </div>
      <Progress
        value={usedPct}
        className={`h-2 ${barColorClass(quota.remaining_hours, quota.total_hours)}`}
      />
      {quota.resource === 'GPU' && quota.refresh_at && (
        <span className='text-[10px] text-muted-foreground'>
          Refetch:{' '}
          {(() => {
            const d = new Date(quota.refresh_at)
            return isNaN(d.getTime())
              ? quota.refresh_at
              : d.toLocaleString(undefined, {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
          })()}
        </span>
      )}
    </div>
  )
}

function QuotaLive({ accountId }: { accountId: string }) {
  const { data: quota, isLoading } = useKaggleQuota(accountId)

  useEffect(() => {
    if (quota) {
      localStorage.setItem(quotaCacheKey(accountId), JSON.stringify(quota))
    }
  }, [quota, accountId])

  if (isLoading) {
    return (
      <div className='my-3 animate-pulse text-xs text-muted-foreground'>
        Loading quota…
      </div>
    )
  }
  if (!quota || quota.length === 0) {
    return (
      <div className='my-3 text-xs text-muted-foreground italic'>
        No usage recorded yet
      </div>
    )
  }
  return (
    <div className='my-3 flex flex-col gap-3 rounded-md border bg-card p-3 shadow-sm'>
      {quota.map((q) => (
        <QuotaRow key={q.resource} quota={q} />
      ))}
    </div>
  )
}

function QuotaCached({
  accountId,
  cacheVersion,
}: {
  accountId: string
  cacheVersion: number
}) {
  const cached = useMemo(
    () => readCachedQuota(accountId, cacheVersion),
    [accountId, cacheVersion]
  )

  if (!cached || cached.length === 0) {
    return (
      <div className='my-3 text-xs text-muted-foreground italic'>
        No quota cached. Use “Update All Quotas” to load.
      </div>
    )
  }
  return (
    <div className='my-3 flex flex-col gap-3 rounded-md border bg-card p-3 opacity-90 shadow-sm'>
      {cached.map((q) => (
        <QuotaRow key={q.resource} quota={q} />
      ))}
    </div>
  )
}

function AccountNote({ accountId }: { accountId: string }) {
  const [note, setNote] = useState(() => {
    try {
      return localStorage.getItem(`kaggle_note_${accountId}`) || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    localStorage.setItem(`kaggle_note_${accountId}`, note)
  }, [note, accountId])

  return (
    <div className='mt-4' onClick={(e) => e.stopPropagation()}>
      <Textarea
        className='min-h-[56px] w-full resize-none border-transparent bg-muted/50 p-2 text-xs hover:border-border focus-visible:ring-1'
        placeholder='Note (auto-saved)...'
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </div>
  )
}

type AccountCardProps = {
  account: KaggleAccount
  isCurrent: boolean
  cacheVersion: number
  onEdit: (account: KaggleAccount) => void
}

export function AccountCard({
  account,
  isCurrent,
  cacheVersion,
  onEdit,
}: AccountCardProps) {
  const setCurrentAccountId = useKaggleStore((s) => s.setCurrentAccountId)
  const setActive = useSetKaggleActiveAccount()
  const removeAccount = useRemoveKaggleAccount()
  const [menuOpen, setMenuOpen] = useState(false)

  const displayName = account.label || account.username || account.id
  const initial = (displayName.charAt(0) || '?').toUpperCase()
  const isManaged = account.source === 'managed'

  const handleSetActive = async () => {
    try {
      const username = await setActive.mutateAsync(account.id)
      toast.success(
        username
          ? `Global CLI account set to "${username}"`
          : 'Global CLI account updated'
      )
    } catch (error) {
      toast.error(`Failed to set active: ${error}`)
    }
  }

  const handleRemove = async () => {
    try {
      await removeAccount.mutateAsync(account.id)
      toast.success(`Account "${displayName}" removed`)
    } catch (error) {
      toast.error(`Failed to remove: ${error}`)
    }
  }

  return (
    <Card
      className={`flex h-full cursor-pointer flex-col transition-all hover:shadow-md ${
        isCurrent ? 'ring-2 ring-primary' : ''
      }`}
      onClick={() => setCurrentAccountId(account.id)}
    >
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-bold text-primary'>
              {initial}
            </div>
            <div className='min-w-0'>
              <CardTitle className='truncate text-base' title={displayName}>
                {displayName}
              </CardTitle>
              <CardDescription className='truncate' title={account.username}>
                {account.username || 'username unknown'}
              </CardDescription>
            </div>
          </div>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant='ghost'
                size='icon'
                className='h-7 w-7 shrink-0'
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(true)
                }}
              >
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem
                disabled={
                  !isManaged || account.is_active_global || setActive.isPending
                }
                onClick={() => {
                  setMenuOpen(false)
                  void handleSetActive()
                }}
              >
                <UserCheck className='mr-2 h-4 w-4' />
                Set Active (global CLI)
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!isManaged}
                onClick={() => {
                  setMenuOpen(false)
                  onEdit(account)
                }}
              >
                <Pencil className='mr-2 h-4 w-4' />
                Edit label
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isManaged ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem
                      onSelect={(e) => e.preventDefault()}
                      className='text-destructive focus:text-destructive'
                    >
                      <Trash2 className='mr-2 h-4 w-4' />
                      Remove account
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove account?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This deletes the app-managed credential folder for{' '}
                        <strong>{displayName}</strong>. Your original{' '}
                        <code>~/.kaggle</code> files are untouched.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRemove}>
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <DropdownMenuItem disabled>
                  <Trash2 className='mr-2 h-4 w-4' />
                  Remove (global — not managed)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className='mt-2 flex flex-wrap items-center gap-1.5'>
          <Badge variant='outline' className='text-xs'>
            {AUTH_METHOD_LABEL[account.auth_method]}
          </Badge>
          {account.is_active_global && (
            <Badge variant='default' className='text-xs'>
              Active
            </Badge>
          )}
          {account.source === 'global' && (
            <Badge variant='secondary' className='text-xs'>
              ~/.kaggle
            </Badge>
          )}
          {account.key_hint && (
            <span className='font-mono text-[10px] text-muted-foreground'>
              {account.key_hint}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className='flex h-full flex-col justify-between pt-0'>
        <div>
          {account.is_active_global ? (
            <QuotaLive accountId={account.id} />
          ) : (
            <QuotaCached accountId={account.id} cacheVersion={cacheVersion} />
          )}
          {account.is_active_global && (
            <div className='flex items-center gap-1 text-xs text-primary'>
              <CheckCircle2 className='h-3.5 w-3.5' />
              Used by CLI outside the app
            </div>
          )}
        </div>
        <AccountNote accountId={account.id} />
      </CardContent>
    </Card>
  )
}
