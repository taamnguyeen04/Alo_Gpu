import { useEffect, useMemo, useState } from 'react'
import {
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trophy,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import * as kaggleApi from '@/lib/kaggle-api'
import type { KaggleAccount } from '@/lib/kaggle-types'
import {
  kaggleKeys,
  useKaggleAccounts,
  useKaggleActiveGlobal,
  useKaggleCliAvailable,
} from '@/hooks/use-kaggle'
import { useKaggleStore } from '@/stores/kaggle-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useQueryClient } from '@tanstack/react-query'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { AccountCard } from './components/account-card'
import { AddAccountDialog } from './components/add-account-dialog'
import { EditAccountDialog } from './components/edit-account-dialog'

const SOURCE_LABEL: Record<string, string> = {
  legacy_key: 'legacy key',
  access_token: 'access_token',
  oauth: 'OAuth',
  env_token: 'KAGGLE_API_TOKEN env',
  cli_env: 'CLI default',
  none: '',
}

function readCachedRemaining(accountId: string): number | null {
  try {
    const raw = localStorage.getItem(`kaggle_quota_${accountId}`)
    if (raw) {
      const quota = JSON.parse(raw)
      const gpu = quota.find((q: { resource: string }) => q.resource === 'GPU')
      if (gpu) return gpu.remaining_hours as number
    }
  } catch {
    // ignore corrupted cache
  }
  return null
}

export function KaggleAccountsDashboard() {
  const queryClient = useQueryClient()
  const { data: accounts, isLoading, isRefetching, refetch } = useKaggleAccounts()
  const { data: activeGlobal } = useKaggleActiveGlobal()
  const { data: cliAvailable } = useKaggleCliAvailable()

  const currentAccountId = useKaggleStore((s) => s.currentAccountId)
  const setCurrentAccountId = useKaggleStore((s) => s.setCurrentAccountId)
  const [sortOption, setSortOption] = useState('name-asc')
  const [cacheVersion, setCacheVersion] = useState(0)
  const [isUpdatingAll, setIsUpdatingAll] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingAccount, setEditingAccount] = useState<KaggleAccount | null>(null)

  // Keep store's currentAccountId valid when accounts change
  useEffect(() => {
    if (!accounts || accounts.length === 0) return
    if (!currentAccountId || !accounts.some((a) => a.id === currentAccountId)) {
      const preferred = accounts.find((a) => a.is_active_global) ?? accounts[0]
      setCurrentAccountId(preferred.id)
    }
  }, [accounts, currentAccountId, setCurrentAccountId])

  const managedAccounts = useMemo(
    () => (accounts || []).filter((a) => a.source === 'managed'),
    [accounts]
  )

  // Totals across accounts based on cached quota snapshots
  const totals = useMemo(() => {
    let remaining = 0
    let total = 0
    let withData = 0
    for (const a of managedAccounts) {
      const r = readCachedRemaining(a.id)
      if (r !== null) {
        withData++
        remaining += r
        total += 30
      }
    }
    return { remaining, total, hasAny: withData > 0 }
    // cacheVersion is intentional: triggers recompute after manual cache refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedAccounts, cacheVersion])

  const handleUpdateAllQuotas = async () => {
    if (managedAccounts.length === 0) return
    setIsUpdatingAll(true)
    toast.info('Updating quotas for all accounts...')
    let updated = 0
    try {
      for (const a of managedAccounts) {
        try {
          const quota = await kaggleApi.getKaggleQuota(a.id)
          localStorage.setItem(`kaggle_quota_${a.id}`, JSON.stringify(quota))
          updated++
        } catch (e) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.error(`Failed to update quota for ${a.label}`, e)
          }
        }
      }
      toast.success(
        updated > 0
          ? `Updated ${updated} account(s). Refetching...`
          : 'No account could be updated. Check the CLI/credentials.'
      )
    } finally {
      setIsUpdatingAll(false)
      setCacheVersion((v) => v + 1)
    }
  }

  const sortedAccounts = useMemo(() => {
    if (!accounts) return []
    const remainingOf = (a: KaggleAccount) => {
      const r = readCachedRemaining(a.id)
      return r === null ? Number.POSITIVE_INFINITY : r
    }
    return [...accounts].sort((x, y) => {
      if (sortOption === 'name-asc') {
        // managed accounts first, then global
        if (x.source !== y.source) return x.source === 'managed' ? -1 : 1
        return (x.label || x.id).localeCompare(y.label || y.id)
      }
      if (sortOption === 'gpu-desc') {
        return remainingOf(y) - remainingOf(x)
      }
      if (sortOption === 'gpu-asc') {
        return remainingOf(x) - remainingOf(y)
      }
      return 0
    })
    // cacheVersion is intentional: re-sort after quota cache refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, sortOption, cacheVersion])

  const showActiveBanner =
    !!activeGlobal && activeGlobal.source !== 'none' && activeGlobal.source !== 'cli_env'

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleUpdateAllQuotas}
            disabled={isUpdatingAll || !accounts || managedAccounts.length === 0}
          >
            {isUpdatingAll ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Gauge className='mr-2 h-4 w-4' />
            )}
            {isUpdatingAll ? 'Updating...' : 'Update All Quotas'}
          </Button>
          <Button variant='outline' size='sm' onClick={() => void refetch()} disabled={isRefetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size='sm' onClick={() => setShowAdd(true)}>
            <Plus className='mr-2 h-4 w-4' />
            Add Account
          </Button>
        </div>
      </Header>

      <Main>
        <div className='mb-6 flex flex-col sm:flex-row gap-4 sm:items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Kaggle Accounts</h1>
            <p className='text-muted-foreground'>
              Manage your Kaggle CLI accounts and monitor GPU quotas
            </p>
          </div>

          {totals.hasAny && (
            <div className='bg-primary/10 border-primary/20 border px-4 py-3 rounded-lg flex flex-col min-w-[200px]'>
              <span className='text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1'>
                GPU Hours Left
              </span>
              <div className='flex items-baseline gap-2'>
                <span className='text-2xl font-bold text-primary'>
                  {totals.remaining.toFixed(1)}h
                </span>
                <span className='text-sm text-muted-foreground'>
                  / {totals.total.toFixed(0)}h
                </span>
              </div>
              <span className='text-[10px] text-muted-foreground mt-1'>
                Across managed accounts (30h/week each)
              </span>
            </div>
          )}
        </div>

        {/* Global CLI account banner */}
        {showActiveBanner && (
          <Card className='mb-6 border-primary/50 bg-primary/5'>
            <CardContent className='pb-4 pt-4'>
              <div className='flex flex-wrap items-center gap-3'>
                <Badge variant='default' className='text-sm px-3 py-1'>
                  CLI Active
                </Badge>
                <span className='text-base font-semibold'>
                  {activeGlobal?.username || '(access token)'}
                </span>
                <Badge variant='outline' className='text-xs'>
                  {SOURCE_LABEL[activeGlobal?.source || 'none']}
                </Badge>
                <span className='text-sm text-muted-foreground'>
                  — credentials currently visible at ~/.kaggle (used by external
                  CLI/scripts)
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <div className='p-4 flex items-center gap-2.5'>
                  <Skeleton className='h-9 w-9 rounded-md' />
                  <div className='space-y-2'>
                    <Skeleton className='h-4 w-24' />
                    <Skeleton className='h-3 w-16' />
                  </div>
                </div>
                <div className='px-4 pb-4'>
                  <Skeleton className='h-16 w-full' />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Accounts grid */}
        {!isLoading && accounts && accounts.length > 0 && (
          <>
            <div className='mb-3 flex items-center justify-between'>
              <div className='text-sm text-muted-foreground'>
                All Accounts ({accounts.length})
              </div>
              <div className='flex items-center gap-2 text-sm'>
                <span className='text-muted-foreground hidden sm:inline'>Sort by:</span>
                <Select value={sortOption} onValueChange={setSortOption}>
                  <SelectTrigger className='w-[180px] h-8'>
                    <SelectValue placeholder='Sort by' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='name-asc'>Name (A-Z)</SelectItem>
                    <SelectItem value='gpu-desc'>GPU Remaining (High to Low)</SelectItem>
                    <SelectItem value='gpu-asc'>GPU Remaining (Low to High)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {sortedAccounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  isCurrent={currentAccountId === account.id}
                  cacheVersion={cacheVersion}
                  onEdit={setEditingAccount}
                />
              ))}
            </div>
          </>
        )}

        {/* Empty states */}
        {!isLoading && accounts?.length === 0 && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              {cliAvailable === false ? (
                <>
                  <Terminal className='h-12 w-12 text-muted-foreground mb-4' />
                  <h3 className='text-lg font-semibold mb-2'>Kaggle CLI not installed</h3>
                  <p className='text-muted-foreground text-center mb-4'>
                    Install it first, then add an account here.
                  </p>
                  <code className='bg-muted px-3 py-1 rounded text-sm'>
                    pipx install kaggle
                  </code>
                </>
              ) : (
                <>
                  <Trophy className='h-12 w-12 text-muted-foreground mb-4' />
                  <h3 className='text-lg font-semibold mb-2'>No Kaggle accounts yet</h3>
                  <p className='text-muted-foreground text-center mb-4'>
                    Add your first account with the API key from kaggle.com/settings/api.
                  </p>
                  <Button size='sm' onClick={() => setShowAdd(true)}>
                    <Plus className='mr-2 h-4 w-4' />
                    Add Account
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </Main>

      <AddAccountDialog open={showAdd} onOpenChange={setShowAdd} />
      <EditAccountDialog
        account={editingAccount}
        onOpenChange={(open) => {
          if (!open) {
            setEditingAccount(null)
            // label may have changed — refresh
            void queryClient.invalidateQueries({
              queryKey: kaggleKeys.accounts,
            })
          }
        }}
      />
    </>
  )
}
