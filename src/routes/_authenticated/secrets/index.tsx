import { createFileRoute } from '@tanstack/react-router'
import { SecretsPage } from '@/features/secrets'

export const Route = createFileRoute('/_authenticated/secrets/')({
  component: SecretsPage,
})
