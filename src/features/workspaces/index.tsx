import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Cloud,
  RefreshCw,
  Search,
  Package,
  HardDrive,
  CheckCircle2,
  DollarSign,
  Activity,
} from 'lucide-react'
import { toast } from 'sonner'
import type { BillingSummary } from '@/lib/modal-types'
import {
  useProfiles,
  useCurrentProfile,
  useActivateProfile,
  useApps,
  useVolumes,
  useBillingSummary,
  useBillingRates,
  queryKeys,
} from '@/hooks/use-modal'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

function WorkspaceNote({ profileName }: { profileName: string }) {
  const [note, setNote] = useState(() => {
    try {
      return localStorage.getItem(`ws_note_${profileName}`) || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    localStorage.setItem(`ws_note_${profileName}`, note)
  }, [note, profileName])

  return (
    <div className='mt-4' onClick={(e) => e.stopPropagation()}>
      <Textarea
        className='min-h-[60px] w-full resize-none border-transparent bg-muted/50 p-2 text-xs hover:border-border focus-visible:ring-1'
        placeholder='Ghi chú (tự động lưu)...'
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </div>
  )
}

function CachedWorkspaceBilling({ profile }: { profile: string }) {
  // Read-only localStorage cache, recomputed when the profile changes
  const cachedBilling = useMemo(() => {
    try {
      const data = localStorage.getItem(`ws_billing_${profile}`)
      if (data) return JSON.parse(data) as BillingSummary
    } catch (error) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('Corrupted billing cache:', error)
      }
    }
    return null
  }, [profile])

  if (!cachedBilling)
    return (
      <div className='mt-2 mb-2 block text-xs text-muted-foreground italic'>
        Chưa có dữ liệu tiền. Click để tải.
      </div>
    )

  const creditsUsed = cachedBilling.adjustments?.credits
    ? Math.abs(parseFloat(cachedBilling.adjustments.credits))
    : 0
  const billedCost = cachedBilling.billed_cost
    ? parseFloat(cachedBilling.billed_cost)
    : 0
  const actualUsed = creditsUsed + billedCost
  const creditsRemaining = Math.max(0, 30 - creditsUsed)

  return (
    <div className='mt-2 mb-2 flex flex-col gap-1'>
      <div className='flex items-center gap-4 text-sm font-medium opacity-70'>
        <span className='flex items-center gap-1 text-green-600 dark:text-green-400'>
          ${creditsRemaining.toFixed(2)}
        </span>
        <span className='flex items-center gap-1 text-muted-foreground'>
          Used: ${actualUsed.toFixed(2)}
        </span>
      </div>
      <span className='block text-xs text-muted-foreground'>
        Click to switch
      </span>
    </div>
  )
}

function ActiveWorkspaceStats({ profile }: { profile: string }) {
  const { data: billing, isLoading: billingLoading } =
    useBillingSummary(profile)
  const { data: apps, isLoading: appsLoading } = useApps(profile)
  const { data: volumes, isLoading: volumesLoading } = useVolumes(profile)

  const activeApps =
    apps?.filter((a) => a.status.toLowerCase() !== 'stopped') || []

  const creditsUsed = billing?.adjustments?.credits
    ? Math.abs(parseFloat(billing.adjustments.credits))
    : 0
  const actualUsed =
    parseFloat(billing?.metered_cost || '0') +
    parseFloat(billing?.billed_cost || '0') -
    creditsUsed
  const creditsLeft = Math.max(0, 30 - creditsUsed)

  useEffect(() => {
    if (billing) {
      localStorage.setItem(`ws_billing_${profile}`, JSON.stringify(billing))
    }
  }, [billing, profile])

  if (billingLoading || appsLoading || volumesLoading) {
    return <Skeleton className='mt-3 h-[60px] w-full' />
  }

  return (
    <div className='mt-3 flex flex-col gap-3 rounded-md border bg-card p-3 shadow-sm'>
      <div className='flex items-center gap-4 text-sm'>
        <div className='flex items-center gap-1.5 text-muted-foreground'>
          <Package className='h-4 w-4' />
          <span>{activeApps.length} apps</span>
        </div>
        <div className='flex items-center gap-1.5 text-muted-foreground'>
          <HardDrive className='h-4 w-4' />
          <span>{volumes?.length || 0} volumes</span>
        </div>
      </div>

      <div className='flex items-end justify-between border-t pt-2'>
        <div className='flex flex-col'>
          <span className='mb-1 text-xs font-medium text-muted-foreground'>
            Credits Left:
          </span>
          <span
            className={`text-lg font-bold ${creditsLeft > 5 ? 'text-green-600' : 'text-orange-500'}`}
          >
            ${creditsLeft.toFixed(2)}
          </span>
        </div>
        <div className='flex flex-col items-end'>
          <span className='mb-1 text-xs text-muted-foreground'>Used:</span>
          <span className='text-sm text-muted-foreground'>
            ${actualUsed.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function WorkspacesDashboard() {
  const { data: profiles, isLoading, refetch, isRefetching } = useProfiles()
  const { data: currentProfile } = useCurrentProfile()
  const activateProfile = useActivateProfile()
  const queryClient = useQueryClient()

  const [sortOption, setSortOption] = useState<string>('name-asc')
  const [isUpdatingAll, setIsUpdatingAll] = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const { data: rates, isLoading: ratesLoading } = useBillingRates(
    showPricing ? currentProfile || undefined : undefined
  )

  const formatProfileName = (name: string) => {
    return name.startsWith('nguyentranminhtam')
      ? name.replace('nguyentranminhtam', 'ntmt')
      : name
  }

  const getCredits = (profileName: string) => {
    try {
      const data = localStorage.getItem(`ws_billing_${profileName}`)
      if (data) {
        const cachedBilling = JSON.parse(data) as BillingSummary
        const creditsUsed = cachedBilling.adjustments?.credits
          ? Math.abs(parseFloat(cachedBilling.adjustments.credits))
          : 0
        return Math.max(0, 30 - creditsUsed)
      }
    } catch {
      return -1 // Corrupted cache entry
    }
    return -1 // Default if no data
  }

  const { totalCreditsLeft, maxCredits } = useMemo(() => {
    if (!profiles || profiles.length === 0)
      return { totalCreditsLeft: 0, maxCredits: 0 }
    let left = 0
    const max = profiles.length * 30
    for (const p of profiles) {
      const c = getCredits(p.name)
      left += c !== -1 ? c : 30 // assume 30 if not cached yet
    }
    return { totalCreditsLeft: left, maxCredits: max }
  }, [profiles])

  const handleUpdateAllCosts = async () => {
    if (!profiles || profiles.length === 0) return
    setIsUpdatingAll(true)
    let updatedCount = 0
    toast.info('Updating costs for all workspaces...')
    try {
      const modalApi = await import('@/lib/modal-api')
      for (const p of profiles) {
        try {
          const res = await modalApi.getBillingSummary(p.name)
          localStorage.setItem(`ws_billing_${p.name}`, JSON.stringify(res))
          updatedCount++
        } catch (e) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.error(`Failed to update ${p.name}`, e)
          }
        }
      }
      toast.success(`Successfully updated ${updatedCount} workspace(s)`)
      // Refetch profiles so the memoized credit totals re-read the fresh cache
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles })
    } finally {
      setIsUpdatingAll(false)
    }
  }

  const sortedProfiles = useMemo(() => {
    if (!profiles) return []
    return [...profiles].sort((a, b) => {
      if (sortOption === 'name-asc') {
        return a.name.localeCompare(b.name)
      } else if (sortOption === 'name-desc') {
        return b.name.localeCompare(a.name)
      } else {
        const cA = getCredits(a.name)
        const cB = getCredits(b.name)

        if (cA === -1 && cB !== -1) return 1
        if (cB === -1 && cA !== -1) return -1
        if (cA === -1 && cB === -1) return a.name.localeCompare(b.name)

        if (sortOption === 'credits-asc') {
          return cA - cB
        } else if (sortOption === 'credits-desc') {
          return cB - cA
        }
      }
      return 0
    })
  }, [profiles, sortOption])

  const handleProfileClick = async (name: string) => {
    if (name !== currentProfile) {
      try {
        await activateProfile.mutateAsync(name)
        toast.success(`Switched to workspace "${formatProfileName(name)}"`)
      } catch (error) {
        toast.error(`Failed to switch workspace: ${error}`)
      }
    }
  }

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <div className='flex items-center gap-2'>
          <Dialog open={showPricing} onOpenChange={setShowPricing}>
            <DialogTrigger asChild>
              <Button variant='outline' size='sm'>
                <Activity className='mr-2 h-4 w-4' />
                GPU Pricing
              </Button>
            </DialogTrigger>
            <DialogContent className='sm:max-w-[500px]'>
              <DialogHeader>
                <DialogTitle>GPU Hourly Rates</DialogTitle>
                <DialogDescription>
                  Current Modal billing rates per hour.
                </DialogDescription>
              </DialogHeader>
              <div className='max-h-[60vh] overflow-y-auto'>
                {ratesLoading ? (
                  <div className='flex justify-center p-4'>
                    <RefreshCw className='h-6 w-6 animate-spin text-muted-foreground' />
                  </div>
                ) : rates ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Resource</TableHead>
                        <TableHead className='text-right'>
                          Price / Hour
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(rates)
                        .filter(([k]) => k.includes('gpu_hour_cost'))
                        .sort(
                          (a, b) =>
                            parseFloat(String(a[1])) - parseFloat(String(b[1]))
                        )
                        .map(([k, v]) => (
                          <TableRow key={k}>
                            <TableCell className='font-medium'>
                              {k.replace('gpu_hour_cost_', '').toUpperCase()}
                            </TableCell>
                            <TableCell className='text-right text-green-600'>
                              ${parseFloat(String(v)).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className='p-4 text-center text-muted-foreground'>
                    Failed to load rates.
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant='outline'
            size='sm'
            onClick={handleUpdateAllCosts}
            disabled={isUpdatingAll || isLoading}
          >
            <DollarSign
              className={`mr-2 h-4 w-4 ${isUpdatingAll ? 'animate-pulse' : ''}`}
            />
            {isUpdatingAll ? 'Updating...' : 'Update All Costs'}
          </Button>
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
      </Header>

      <Main>
        <div className='mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Workspaces</h1>
            <p className='text-muted-foreground'>
              Manage your Modal workspaces and profiles
            </p>
          </div>

          {profiles && profiles.length > 0 && (
            <div className='flex min-w-[200px] flex-col rounded-lg border border-primary/20 bg-primary/10 px-4 py-3'>
              <span className='mb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase'>
                Total Credits Left
              </span>
              <div className='flex items-baseline gap-2'>
                <span className='text-2xl font-bold text-primary'>
                  ${totalCreditsLeft.toFixed(2)}
                </span>
                <span className='text-sm text-muted-foreground'>
                  / ${maxCredits.toFixed(2)}
                </span>
              </div>
              <span className='mt-1 text-[10px] text-muted-foreground'>
                Across {profiles.length} workspaces
              </span>
            </div>
          )}
        </div>

        {/* Current Profile Banner */}
        {currentProfile && (
          <Card className='mb-6 border-primary/50 bg-primary/5'>
            <CardHeader className='pb-3'>
              <CardTitle className='flex items-center gap-2 text-lg'>
                <CheckCircle2 className='h-5 w-5 text-primary' />
                Active Workspace
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-3'>
                  <Badge variant='default' className='px-4 py-1 text-base'>
                    {formatProfileName(currentProfile)}
                  </Badge>
                  {profiles && profiles.length > 0 && (
                    <span className='text-sm text-muted-foreground'>
                      {profiles.length} workspace
                      {profiles.length !== 1 ? 's' : ''} available
                    </span>
                  )}
                </div>
                <ActiveWorkspaceStats profile={currentProfile} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className='h-6 w-24' />
                </CardHeader>
                <CardContent>
                  <Skeleton className='mb-2 h-4 w-16' />
                  <Skeleton className='h-4 w-20' />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Workspaces Grid */}
        {!isLoading && profiles && profiles.length > 0 && (
          <>
            <div className='mb-3 flex items-center justify-between'>
              <div className='text-sm text-muted-foreground'>
                All Workspaces ({profiles.length})
              </div>
              <div className='flex items-center gap-2 text-sm'>
                <span className='hidden text-muted-foreground sm:inline'>
                  Sort by:
                </span>
                <Select value={sortOption} onValueChange={setSortOption}>
                  <SelectTrigger className='h-8 w-[180px]'>
                    <SelectValue placeholder='Sort by' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='name-asc'>Name (A-Z)</SelectItem>
                    <SelectItem value='name-desc'>Name (Z-A)</SelectItem>
                    <SelectItem value='credits-desc'>
                      Credits (High to Low)
                    </SelectItem>
                    <SelectItem value='credits-asc'>
                      Credits (Low to High)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {sortedProfiles.map((profile) => {
                const isActive = profile.name === currentProfile
                return (
                  <Card
                    key={profile.name}
                    className={`flex h-full cursor-pointer flex-col transition-all hover:shadow-md ${
                      isActive ? 'ring-2 ring-primary' : ''
                    }`}
                    onClick={() => handleProfileClick(profile.name)}
                  >
                    <CardHeader className='pb-2'>
                      <div className='flex items-center justify-between'>
                        <CardTitle className='text-base' title={profile.name}>
                          {formatProfileName(profile.name)}
                        </CardTitle>
                        {isActive && (
                          <Badge variant='default' className='text-xs'>
                            Active
                          </Badge>
                        )}
                      </div>
                      <CardDescription className='mt-1 flex items-center gap-1'>
                        <Cloud className='h-3.5 w-3.5' />
                        {formatProfileName(profile.workspace)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className='flex h-full flex-col justify-between pt-0'>
                      <div>
                        {isActive ? (
                          <ActiveWorkspaceStats profile={profile.name} />
                        ) : (
                          <CachedWorkspaceBilling profile={profile.name} />
                        )}
                      </div>
                      <WorkspaceNote profileName={profile.name} />
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </>
        )}

        {/* Empty State */}
        {!isLoading && profiles?.length === 0 && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <Cloud className='mb-4 h-12 w-12 text-muted-foreground' />
              <h3 className='mb-2 text-lg font-semibold'>No profiles found</h3>
              <p className='mb-4 text-center text-muted-foreground'>
                Make sure Modal CLI is installed and you have authenticated.
              </p>
              <code className='rounded bg-muted px-3 py-1 text-sm'>
                modal profile list
              </code>
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}
