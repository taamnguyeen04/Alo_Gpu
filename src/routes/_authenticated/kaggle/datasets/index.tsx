import { createFileRoute } from '@tanstack/react-router'
import { KaggleDatasetsPage } from '@/features/kaggle/datasets'

export const Route = createFileRoute('/_authenticated/kaggle/datasets/')({
  component: KaggleDatasetsPage,
})
