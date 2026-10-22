import { useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { LineChart, Loader2, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TensorBoardChart } from './components/tensorboard-chart'

// Mock data for demonstration - in real app, this would come from volume files
const mockRunData = {
  run_1: {
    tags: ['loss', 'accuracy', 'learning_rate'],
    events: [
      { step: 0, loss: 2.5, accuracy: 0.1, learning_rate: 0.01 },
      { step: 100, loss: 2.0, accuracy: 0.25, learning_rate: 0.01 },
      { step: 200, loss: 1.5, accuracy: 0.45, learning_rate: 0.01 },
      { step: 300, loss: 1.0, accuracy: 0.6, learning_rate: 0.009 },
      { step: 400, loss: 0.7, accuracy: 0.75, learning_rate: 0.008 },
      { step: 500, loss: 0.5, accuracy: 0.85, learning_rate: 0.007 },
    ],
  },
  run_2: {
    tags: ['loss', 'accuracy'],
    events: [
      { step: 0, loss: 2.8, accuracy: 0.05 },
      { step: 100, loss: 2.2, accuracy: 0.2 },
      { step: 200, loss: 1.8, accuracy: 0.4 },
      { step: 300, loss: 1.2, accuracy: 0.55 },
      { step: 400, loss: 0.8, accuracy: 0.7 },
      { step: 500, loss: 0.6, accuracy: 0.8 },
    ],
  },
}

const routeApi = getRouteApi('/_authenticated/tensorboard/')

export function TensorBoardPage() {
  const { url } = routeApi.useSearch()

  const [selectedRun, setSelectedRun] = useState<string>('run_1')
  const [selectedMetric, setSelectedMetric] = useState<string>('loss')
  const [isLoading, setIsLoading] = useState(false)

  const runNames = Object.keys(mockRunData)
  const currentRun = mockRunData[selectedRun as keyof typeof mockRunData]
  const availableMetrics = currentRun?.tags || []

  const navigate = routeApi.useNavigate()

  const handleLoadLocalFolder = async () => {
    try {
      setIsLoading(true)
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select TensorBoard Log Directory',
      })

      if (selected && typeof selected === 'string') {
        const { invoke } = await import('@tauri-apps/api/core')

        toast.promise(
          (async () => {
            const res = await invoke<{ url: string }>('start_tensorboard', {
              logdir: selected,
            })
            navigate({ search: { url: res.url } })
          })(),
          {
            loading: 'Starting TensorBoard...',
            success: 'TensorBoard started!',
            error: (err) => `Failed to start TensorBoard: ${err}`,
          }
        )
      }
    } catch (err) {
      toast.error(`Failed to start TensorBoard: ${err}`)
    } finally {
      setIsLoading(false)
    }
  }

  if (url) {
    return (
      <div className='flex h-[calc(100vh-120px)] w-full flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>TensorBoard</h1>
            <p className='text-muted-foreground'>
              Connected to local TensorBoard server
            </p>
          </div>
        </div>
        <div className='flex-1 overflow-hidden rounded-md border bg-white shadow-sm'>
          <iframe
            src={url}
            className='h-full w-full border-0'
            title='TensorBoard'
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className='mb-6 flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>TensorBoard</h1>
          <p className='text-muted-foreground'>
            Visualize and analyze your training metrics
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button onClick={handleLoadLocalFolder} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <FolderOpen className='mr-2 h-4 w-4' />
            )}
            Load Local Folder
          </Button>
        </div>
      </div>

      {/* Metrics Selection */}
      <Card className='mb-6'>
        <CardContent className='pt-6'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-end'>
            <div className='flex-1'>
              <label className='text-sm font-medium'>Run</label>
              <Select value={selectedRun} onValueChange={setSelectedRun}>
                <SelectTrigger className='mt-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {runNames.map((run) => (
                    <SelectItem key={run} value={run}>
                      {run}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex-1'>
              <label className='text-sm font-medium'>Metric</label>
              <Select value={selectedMetric} onValueChange={setSelectedMetric}>
                <SelectTrigger className='mt-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableMetrics.map((metric) => (
                    <SelectItem key={metric} value={metric}>
                      {metric}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <LineChart className='h-5 w-5' />
            {selectedMetric} - {selectedRun}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TensorBoardChart
            data={currentRun?.events || []}
            metric={selectedMetric}
          />
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className='mt-6'>
        <CardContent className='pt-6'>
          <div className='flex items-start gap-3'>
            <div className='rounded-full bg-blue-100 p-2'>
              <LineChart className='h-5 w-5 text-blue-600' />
            </div>
            <div>
              <h3 className='font-medium'>How to use TensorBoard</h3>
              <p className='mt-1 text-sm text-muted-foreground'>
                1. Upload your TensorBoard event files to a Modal volume
                <br />
                2. Select the volume and navigate to the event files
                <br />
                3. Click "Load Events" to visualize your training metrics
                <br />
                4. Switch between runs and metrics to compare performance
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
