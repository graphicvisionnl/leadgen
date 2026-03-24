'use client'

interface StatCard {
  label: string
  value: number
  color?: string
}

interface StatsCardsProps {
  stats: {
    scraped: number
    qualified: number
    deployed: number
    sent: number
  }
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards: StatCard[] = [
    { label: 'Gescraped vandaag', value: stats.scraped },
    { label: 'Gekwalificeerd',    value: stats.qualified, color: 'text-blue-400' },
    { label: 'Preview live',      value: stats.deployed,  color: 'text-brand' },
    { label: 'Mail verzonden',    value: stats.sent,      color: 'text-green-400' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-surface rounded-xl border border-subtle p-5">
          <p className="text-white/45 text-xs font-medium uppercase tracking-wider mb-3">
            {card.label}
          </p>
          <p className={`text-3xl font-bold ${card.color ?? 'text-white'}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  )
}
