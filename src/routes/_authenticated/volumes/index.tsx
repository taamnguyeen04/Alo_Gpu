import { createFileRoute } from '@tanstack/react-router'
import { VolumesPage } from '@/features/volumes'

export const Route = createFileRoute('/_authenticated/volumes/')({
  component: VolumesPage,
})
