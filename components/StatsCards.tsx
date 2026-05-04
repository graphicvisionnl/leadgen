'use client'

import Link from 'next/link'

interface StatsCardsProps {
  stats: {
    email_ready?: number
    replied?: number
    due_followups?: number
    hot_leads?: number
  }
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      label: 'Klaar om te sturen',
      value: stats.email_ready ?? 0,
      detail: 'Concept klaar, nog niet verzonden',
      href: '/leads?filter=ready_to_send',
      color: 'text-blue-400',
      highlight: (stats.email_ready ?? 0) > 0,
    },
    {
      label: 'Replies',
      value: stats.replied ?? 0,
      detail: 'Reacties ontvangen',
      href: '/leads?filter=replied',
      color: 'text-green-400',
      highlight: (stats.replied ?? 0) > 0,
    },
    {
      label: 'Follow-ups',
      value: stats.due_followups ?? 0,
      detail: 'Klaar om te versturen',
      href: '/leads?filter=sent',
      color: 'text-yellow-400',
      highlight: (stats.due_followups ?? 0) > 0,
    },
    {
      label: 'Hot leads',
      value: stats.hot_leads ?? 0,
      detail: 'Score ≥ 65, nog niet benaderd',
      href: '/leads?filter=to_review',
      color: 'text-brand',
      highlight: (stats.hot_leads ?? 0) > 0,
    },
  ]

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {cards.map((card) => (
        <Link
          key={card.label}
          href={card.href}
          className={`bg-surface rounded-lg border transition-colors p-5 hover:bg-white/[0.03] ${
            card.highlight ? 'border-white/15 hover:border-white/25' : 'border-subtle hover:border-white/15'
          }`}
        >
          <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-3">
            {card.label}
          </p>
          <p className={`text-3xl font-bold ${card.color}`}>
            {card.value}
          </p>
          <p className="text-white/30 text-xs mt-2">{card.detail}</p>
        </Link>
      ))}
    </div>
  )
}
