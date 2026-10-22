import { useState, useEffect } from 'react'
import {
  Package,
  Square,
  RotateCw,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCurrentProfile, useApps, useStopApp } from '@/hooks/use-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { AppLogsViewer } from './components/app-logs-viewer'

export function AppsPage() {
  const { data: currentProfile } = useCurrentProfile()
  const {
    data: apps,
    isLoading,
    refetch,
    isRefetching,
  } = useApps(currentProfile || undefined)
  const stopApp = useStopApp()
  const [selectedApp, setSelectedApp] = useState<string | null>(null)

  const [deletedApps, setDeletedApps] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('deleted_apps')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    const handleStorage = () => {
      try {
        const stored = localStorage.getItem('deleted_apps')
        if (stored) setDeletedApps(JSON.parse(stored))
      } catch {
        // Ignore malformed entries while other windows are writing
      }
    }
    const interval = setInterval(handleStorage, 1000)
    return () => clearInterval(interval)
  }, [])

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
      case 'active':
        return <CheckCircle2 className='h-4 w-4 text-green-500' />
      case 'stopped':
      case 'inactive':
        return <Square className='h-4 w-4 text-gray-500' />
      case 'error':
      case 'failed':
        return <XCircle className='h-4 w-4 text-red-500' />
      case 'pending':
      case 'starting':
        return <Loader2 className='h-4 w-4 animate-spin text-yellow-500' />
      default:
        return <AlertCircle className='h-4 w-4 text-muted-foreground' />
    }
  }

  const getStatusBadge = (status: string) => {
    const variant =
      status.toLowerCase().includes('run') ||
      status.toLowerCase().includes('active')
        ? 'default'
        : status.toLowerCase().includes('error') ||
            status.toLowerCase().includes('fail')
          ? 'destructive'
          : 'secondary'

    return (
      <Badge variant={variant as 'default' | 'destructive' | 'secondary'}>
        {status}
      </Badge>
    )
  }

  const handleDeleteApp = async (appName: string) => {
    try {
      await stopApp.mutateAsync(appName)
      const stored = localStorage.getItem('deleted_apps')
      const deleted = stored ? JSON.parse(stored) : []
      if (!deleted.includes(appName)) {
        deleted.push(appName)
        localStorage.setItem('deleted_apps', JSON.stringify(deleted))
        setDeletedApps([...deleted])
      }
      toast.success(`App "${appName}" deleted`)
      refetch()
    } catch (error) {
      toast.error(`Failed to delete app: ${error}`)
    }
  }

  const displayApps =
    apps?.filter((app) => !deletedApps.includes(app.name)) || []

  const isRunning = (status: string) => {
    return (
      status.toLowerCase().includes('run') ||
      status.toLowerCase().includes('active')
    )
  }

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2'>
          <span className='text-sm text-muted-foreground'>
            Profile: <Badge variant='outline'>{currentProfile || 'None'}</Badge>
          </span>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => refetch()}
          disabled={isRefetching}
          className='ml-auto'
        >
          <RotateCw
            className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </Header>

      <Main>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold tracking-tight'>Apps</h1>
          <p className='text-muted-foreground'>
            Manage your Modal applications
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className='space-y-4'>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className='h-20 w-full' />
            ))}
          </div>
        )}

        {/* Apps Table */}
        {!isLoading && apps && (
          <>
            <Card>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-12'>Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className='text-right'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayApps.map((app) => (
                      <TableRow key={app.name}>
                        <TableCell>
                          <div className='flex items-center'>
                            {getStatusIcon(app.status)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='font-medium'>{app.name}</div>
                          <div className='text-sm text-muted-foreground'>
                            {getStatusBadge(app.status)}
                          </div>
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {app.created_at}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex items-center justify-end gap-1'>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8'
                              title='View Logs'
                              onClick={() => setSelectedApp(app.name)}
                            >
                              <Eye className='h-4 w-4' />
                            </Button>
                            {isRunning(app.status) ? (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-8 w-8 text-red-500 hover:text-red-600'
                                title='Stop App'
                                onClick={() => handleDeleteApp(app.name)}
                                disabled={stopApp.isPending}
                              >
                                <Square className='h-4 w-4' />
                              </Button>
                            ) : (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-8 w-8 text-red-500 hover:text-red-600'
                                title='Delete App'
                                onClick={() => handleDeleteApp(app.name)}
                                disabled={stopApp.isPending}
                              >
                                <XCircle className='h-4 w-4' />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Empty State */}
            {displayApps.length === 0 && (
              <Card>
                <CardContent className='flex flex-col items-center justify-center py-12'>
                  <Package className='mb-4 h-12 w-12 text-muted-foreground' />
                  <h3 className='mb-2 text-lg font-semibold'>No apps found</h3>
                  <p className='text-center text-muted-foreground'>
                    Deploy your first Modal app to see it here.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Main>

      {/* Logs Viewer Dialog */}
      {selectedApp && (
        <AppLogsViewer
          appName={selectedApp}
          open={!!selectedApp}
          onClose={() => setSelectedApp(null)}
        />
      )}
    </>
  )
}
