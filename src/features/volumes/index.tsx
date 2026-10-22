import { useState } from 'react'
import { HardDrive, Upload, FolderOpen, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCurrentProfile,
  useVolumes,
  useVolumeCreate,
} from '@/hooks/use-modal'
import { Badge } from '@/components/ui/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { VolumeBrowser } from './components/volume-browser'
import { VolumeUploader } from './components/volume-uploader'

export function VolumesPage() {
  const { data: currentProfile } = useCurrentProfile()
  const {
    data: volumes,
    isLoading,
    refetch,
    isRefetching,
  } = useVolumes(currentProfile || undefined)
  const createVolume = useVolumeCreate()

  const [selectedVolume, setSelectedVolume] = useState<string | null>(null)
  const [newVolumeName, setNewVolumeName] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const handleCreateVolume = async () => {
    if (!newVolumeName.trim()) {
      toast.error('Volume name is required')
      return
    }

    try {
      await createVolume.mutateAsync(newVolumeName.trim())
      toast.success(`Volume "${newVolumeName}" created successfully`)
      setNewVolumeName('')
      setIsCreateOpen(false)
      refetch()
    } catch (error) {
      toast.error(`Failed to create volume: ${error}`)
    }
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
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </Header>

      <Main>
        <div className='mb-6 flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Volumes</h1>
            <p className='text-muted-foreground'>
              Manage your Modal volumes and files
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size='sm'>
                <Plus className='mr-2 h-4 w-4' />
                Create Volume
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Volume</DialogTitle>
              </DialogHeader>
              <div className='space-y-4 pt-4'>
                <div>
                  <label className='text-sm font-medium'>Volume Name</label>
                  <Input
                    placeholder='e.g., model-weights'
                    value={newVolumeName}
                    onChange={(e) => setNewVolumeName(e.target.value)}
                    className='mt-1'
                  />
                </div>
                <div className='flex justify-end gap-2'>
                  <Button
                    variant='outline'
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateVolume}
                    disabled={createVolume.isPending}
                  >
                    {createVolume.isPending ? 'Creating...' : 'Create'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Volume Grid */}
        {isLoading && (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className='p-6'>
                  <div className='h-6 w-24 animate-pulse rounded bg-muted' />
                  <div className='mt-2 h-4 w-32 animate-pulse rounded bg-muted' />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && volumes && volumes.length > 0 && (
          <div className='mb-6'>
            <h2 className='mb-3 text-sm font-medium text-muted-foreground'>
              Select a volume ({volumes.length})
            </h2>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {volumes.map((volume) => (
                <Card
                  key={volume.name}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedVolume === volume.name ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => setSelectedVolume(volume.name)}
                >
                  <CardContent className='p-6'>
                    <div className='mb-2 flex items-center gap-2'>
                      <HardDrive className='h-5 w-5' />
                      <span className='font-medium'>{volume.name}</span>
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      {volume.created_at || 'Created recently'}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && volumes?.length === 0 && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <HardDrive className='mb-4 h-12 w-12 text-muted-foreground' />
              <h3 className='mb-2 text-lg font-semibold'>No volumes found</h3>
              <p className='mb-4 text-center text-muted-foreground'>
                Create your first volume to start storing files.
              </p>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className='mr-2 h-4 w-4' />
                Create Volume
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Selected Volume Tabs */}
        {selectedVolume && (
          <Tabs defaultValue='browser' className='mt-6'>
            <TabsList>
              <TabsTrigger value='browser'>
                <FolderOpen className='mr-2 h-4 w-4' />
                Browser
              </TabsTrigger>
              <TabsTrigger value='upload'>
                <Upload className='mr-2 h-4 w-4' />
                Upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value='browser' className='mt-4'>
              <VolumeBrowser key={selectedVolume} volumeName={selectedVolume} />
            </TabsContent>

            <TabsContent value='upload' className='mt-4'>
              <VolumeUploader volumeName={selectedVolume} />
            </TabsContent>
          </Tabs>
        )}
      </Main>
    </>
  )
}
