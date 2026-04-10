'use client'

interface StatsCardsProps {
  stats: {
    scraped: number
    qualified: number
    deployed: number
    sent: number
    hot_leads?: number
    due_followups?: number
  }
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    { label: 'Gescraped',        value: stats.scraped,                   color: 'text-white' },
    { label: 'Gekwalificeerd',   value: stats.qualified,                 color: 'text-blue-400' },
    { label: 'Preview live',     value: stats.deployed,                  color: 'text-brand' },
    { label: 'Mail verzonden',   value: stats.sent,                      color: 'text-green-400' },
    { label: 'Hot leads',        value: stats.hot_leads ?? 0,            color: 'text-yellow-400' },
    { label: 'Follow-ups klaar', value: stats.due_followups ?? 0,        color: 'text-red-400' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-surface rounded-xl border border-subtle p-4">
          <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-2">
            {card.label}
          </p>
          <p className={`text-2xl font-bold ${card.color}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  )
}
