'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/scraped', label: 'Scraped' },
  { href: '/qualified', label: 'Qualified' },
  { href: '/redesigns', label: 'Redesigns' },
  { href: '/deployed', label: 'Deployed' },
  { href: '/contacted', label: 'Benaderd' },
  { href: '/settings', label: 'Instellingen' },
]

export function AppNav() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  return (
    <nav className="border-b border-subtle bg-dark/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z" fill="white" fillOpacity="0.9" />
              </svg>
            </div>
            <span className="font-semibold text-sm truncate">Graphic Vision</span>
            <span className="hidden sm:inline text-white/30 text-sm">/</span>
            <span className="hidden sm:inline text-white/50 text-sm">Lead Gen</span>
          </div>

          <div className="hidden md:flex items-center gap-5 text-sm">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={isActive ? 'text-white' : 'text-white/60 hover:text-white transition-colors'}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>

          <button
            type="button"
            className="md:hidden px-3 py-1.5 rounded-lg border border-subtle bg-surface text-white/75 hover:text-white hover:border-white/20 transition-colors text-sm"
            onClick={() => setIsOpen((open) => !open)}
            aria-label="Open menu"
            aria-expanded={isOpen}
          >
            {isOpen ? 'Sluit' : 'Menu'}
          </button>
        </div>

        {isOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-subtle grid gap-1">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </nav>
  )
}
