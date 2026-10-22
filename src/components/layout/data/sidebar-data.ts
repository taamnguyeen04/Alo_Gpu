import {
  LayoutDashboard,
  HardDrive,
  Package,
  Lock,
  LineChart,
  Settings,
  Trophy,
  Database,
  FileCode,
} from 'lucide-react'
import type { SidebarData } from '../types'
import { ModalLogo } from '@/components/logos/modal-logo'
import { KaggleLogo } from '@/components/logos/kaggle-logo'

export const sidebarData: SidebarData = {
  user: {
    name: 'alotamne',
    email: 'user@modal.com',
    avatar: '/avatars/a.png',
  },
  navGroups: [
    {
      title: 'Modal',
      logo: ModalLogo,
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
      title: 'Kaggle',
      logo: KaggleLogo,
      items: [
        {
          title: 'Accounts',
          url: '/kaggle/accounts',
          icon: Trophy,
        },
        {
          title: 'Kernels',
          url: '/kaggle/kernels',
          icon: FileCode,
        },
        {
          title: 'Datasets',
          url: '/kaggle/datasets',
          icon: Database,
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
