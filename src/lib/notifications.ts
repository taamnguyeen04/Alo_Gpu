// Notification service for AloGPU
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

export interface NotificationOptions {
  title: string
  body: string
  icon?: 'info' | 'warning' | 'error' | 'success'
}

class NotificationService {
  private permissionGranted = false

  async init() {
    try {
      this.permissionGranted = await isPermissionGranted()

      if (!this.permissionGranted) {
        const permission = await requestPermission()
        this.permissionGranted = permission === 'granted'
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('Failed to initialize notifications:', error)
      }
    }
  }

  async notify(options: NotificationOptions) {
    if (!this.permissionGranted) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('Notifications not permitted')
      }
      return
    }

    try {
      sendNotification({
        title: options.title,
        body: options.body,
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('Failed to send notification:', error)
      }
    }
  }

  // Specific notification types
  async notifyAppCrash(appName: string, error?: string) {
    await this.notify({
      title: `App Crashed: ${appName}`,
      body: error || 'An error occurred in your Modal app.',
      icon: 'error',
    })
  }

  async notifyUploadComplete(filename: string) {
    await this.notify({
      title: 'Upload Complete',
      body: `${filename} has been uploaded successfully.`,
      icon: 'success',
    })
  }

  async notifyDownloadComplete(filename: string) {
    await this.notify({
      title: 'Download Complete',
      body: `${filename} has been downloaded successfully.`,
      icon: 'success',
    })
  }

  async notifyVolumeCreated(volumeName: string) {
    await this.notify({
      title: 'Volume Created',
      body: `Volume "${volumeName}" has been created successfully.`,
      icon: 'success',
    })
  }

  async notifyVolumeDeleted(volumeName: string) {
    await this.notify({
      title: 'Volume Deleted',
      body: `Volume "${volumeName}" has been deleted.`,
      icon: 'info',
    })
  }

  async notifyProfileSwitched(profileName: string) {
    await this.notify({
      title: 'Profile Switched',
      body: `Now using profile: ${profileName}`,
      icon: 'info',
    })
  }
}

export const notificationService = new NotificationService()
