import { createFileRoute } from '@tanstack/react-router'
import { KaggleKernelsPage } from '@/features/kaggle/kernels'

export const Route = createFileRoute('/_authenticated/kaggle/kernels/')({
  component: KaggleKernelsPage,
})
