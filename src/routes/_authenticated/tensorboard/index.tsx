import { createFileRoute } from '@tanstack/react-router'
import { TensorBoardPage } from '@/features/tensorboard'

interface TensorBoardSearch {
  url?: string
}

export const Route = createFileRoute('/_authenticated/tensorboard/')({
  validateSearch: (search: Record<string, unknown>): TensorBoardSearch => {
    return {
      url: search.url as string | undefined,
    }
  },
  component: TensorBoardPage,
})
