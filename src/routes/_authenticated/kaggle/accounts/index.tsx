import { createFileRoute } from '@tanstack/react-router'
import { KaggleAccountsDashboard } from '@/features/kaggle/accounts'

export const Route = createFileRoute('/_authenticated/kaggle/accounts/')({
  component: KaggleAccountsDashboard,
})
