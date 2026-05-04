'use client'

interface PaginationControlsProps {
  page: number
  total: number
  totalPages: number
  itemCount: number
  isLoading?: boolean
  itemLabel?: string
  pageSize?: number
  onPageChange: (page: number) => void
}

export function PaginationControls({
  page,
  total,
  totalPages,
  itemCount,
  isLoading = false,
  itemLabel = 'leads',
  pageSize = 50,
  onPageChange,
}: PaginationControlsProps) {
  const safeTotalPages = Math.max(totalPages, 1)
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = total === 0 ? 0 : rangeStart + itemCount - 1

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="text-xs text-white/40">
        {total === 0 ? `Geen ${itemLabel}` : `${rangeStart}-${rangeEnd} van ${total} ${itemLabel}`}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || isLoading}
          className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-subtle text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 disabled:hover:text-white/60"
        >
          Vorige
        </button>
        <span className="text-xs text-white/45 min-w-[96px] text-center">
          Pagina {page} van {safeTotalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(safeTotalPages, page + 1))}
          disabled={page >= safeTotalPages || isLoading}
          className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-subtle text-white/60 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 disabled:hover:text-white/60"
        >
          Volgende
        </button>
      </div>
    </div>
  )
}
