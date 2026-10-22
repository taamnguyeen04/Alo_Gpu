import {
  LayoutDashboard,
  HardDrive,
  Package,
  Lock,
  LineChart,
  Settings,
} from 'lucide-react'
import type { SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'alotamne',
    email: 'user@modal.com',
    avatar: '/avatars/a.png',
  },
  navGroups: [
    {
      title: 'Dashboard',
      items: [
        {
          title: 'Workspaces',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Apps',
          url: '/apps',
          icon: Package,
        },
        {
          title: 'Volumes',
          url: '/volumes',
          icon: HardDrive,
        },
        {
          title: 'Secrets',
          url: '/secrets',
          icon: Lock,
        },
      ],
    },
    {
      title: 'Tools',
      items: [
        {
          title: 'TensorBoard',
          url: '/tensorboard',
          icon: LineChart,
        },
      ],
    },
    {
      title: 'Settings',
      items: [
        {
          title: 'Preferences',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
