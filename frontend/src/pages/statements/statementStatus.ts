import type { StatementStatus } from '../../lib/useApi'

export const STATUS_INFO: Record<StatementStatus, { label: string; tone: string }> = {
  staged: { label: 'Ready to confirm', tone: 'status--warn' },
  needs_review: { label: 'Needs review', tone: 'status--warn' },
  imported: { label: 'Imported', tone: 'status--good' },
  partial: { label: 'Imported with warnings', tone: 'status--warn' },
  failed: { label: 'Failed', tone: 'status--bad' },
  cancelled: { label: 'Cancelled', tone: 'status--muted' },
}

export const isReviewing = (status: StatementStatus) => status === 'staged' || status === 'needs_review'
