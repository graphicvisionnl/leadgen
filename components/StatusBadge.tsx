import { LeadStatus } from '@/types'
import { clsx } from 'clsx'

const STATUS_CONFIG: Record<LeadStatus, { label: string; classes: string }> = {
  scraped:      { label: 'Gescraped',    classes: 'bg-white/10 text-white/60' },
  no_email:     { label: 'Geen e-mail',  classes: 'bg-yellow-500/15 text-yellow-400' },
  qualified:    { label: 'Gekwalificeerd', classes: 'bg-blue-500/15 text-blue-400' },
  disqualified: { label: 'Afgewezen',    classes: 'bg-red-500/15 text-red-400' },
  redesigned:   { label: 'Redesigned',   classes: 'bg-purple-500/15 text-purple-400' },
  deployed:     { label: 'Deployed',     classes: 'bg-brand/20 text-brand' },
  sent:         { label: 'Verzonden',    classes: 'bg-green-500/15 text-green-400' },
  error:        { label: 'Fout',         classes: 'bg-red-600/20 text-red-400' },
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.error
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', config.classes)}>
      {config.label}
    </span>
  )
}
