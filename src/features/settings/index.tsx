import { useState } from 'react'
import { Cloud, Bell, Download, Monitor } from 'lucide-react'
import { toast } from 'sonner'
import { useModalStore } from '@/stores/modal-store'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

export function SettingsPage() {
  const { concurrency, setConcurrency } = useModalStore()
  const [notifications, setNotifications] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval, setRefreshInterval] = useState('30')

  const handleSave = () => {
    toast.success('Settings saved successfully')
  }

  return (
    <div className='max-w-2xl space-y-6'>
      <div>
        <h2 className='text-lg font-semibold'>Settings</h2>
        <p className='text-sm text-muted-foreground'>
          Configure your AloGPU preferences
        </p>
      </div>

      {/* Modal Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Cloud className='h-5 w-5' />
            Modal Preferences
          </CardTitle>
          <CardDescription>
            Configure how the app interacts with Modal
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div>
              <Label>Auto-refresh data</Label>
              <p className='text-sm text-muted-foreground'>
                Automatically refresh profiles, apps, and volumes
              </p>
            </div>
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='refresh-interval'>Refresh Interval (seconds)</Label>
            <Select value={refreshInterval} onValueChange={setRefreshInterval}>
              <SelectTrigger id='refresh-interval' className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='10'>10 seconds</SelectItem>
                <SelectItem value='30'>30 seconds</SelectItem>
                <SelectItem value='60'>1 minute</SelectItem>
                <SelectItem value='300'>5 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Upload/Download Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Download className='h-5 w-5' />
            Transfer Settings
          </CardTitle>
          <CardDescription>
            Configure file upload and download behavior
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='concurrency'>Default Upload Concurrency</Label>
            <p className='text-sm text-muted-foreground'>
              Number of files to upload/download simultaneously
            </p>
            <Select
              value={String(concurrency)}
              onValueChange={(v) => setConcurrency(Number(v))}
            >
              <SelectTrigger id='concurrency' className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='1'>1 (Sequential)</SelectItem>
                <SelectItem value='2'>2</SelectItem>
                <SelectItem value='3'>3 (Recommended)</SelectItem>
                <SelectItem value='5'>5</SelectItem>
                <SelectItem value='10'>10 (Fast)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className='flex items-center justify-between'>
            <div>
              <Label>Skip existing files</Label>
              <p className='text-sm text-muted-foreground'>
                Don't re-upload files that already exist in the volume
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Bell className='h-5 w-5' />
            Notifications
          </CardTitle>
          <CardDescription>Configure desktop notifications</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div>
              <Label>Enable notifications</Label>
              <p className='text-sm text-muted-foreground'>
                Receive desktop notifications for app events
              </p>
            </div>
            <Switch
              checked={notifications}
              onCheckedChange={setNotifications}
            />
          </div>

          <Separator />

          <div className='flex items-center justify-between'>
            <div>
              <Label>Upload complete</Label>
              <p className='text-sm text-muted-foreground'>
                Notify when file uploads finish
              </p>
            </div>
            <Switch defaultChecked />
          </div>

          <div className='flex items-center justify-between'>
            <div>
              <Label>App status changes</Label>
              <p className='text-sm text-muted-foreground'>
                Notify when apps start, stop, or crash
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      {/* Display Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Monitor className='h-5 w-5' />
            Display
          </CardTitle>
          <CardDescription>Configure display preferences</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div>
              <Label>Compact sidebar</Label>
              <p className='text-sm text-muted-foreground'>
                Use a more compact sidebar layout
              </p>
            </div>
            <Switch />
          </div>

          <div className='flex items-center justify-between'>
            <div>
              <Label>Show workspace grid on startup</Label>
              <p className='text-sm text-muted-foreground'>
                Display workspaces dashboard when app opens
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className='flex justify-end'>
        <Button onClick={handleSave}>Save Settings</Button>
      </div>
    </div>
  )
}
