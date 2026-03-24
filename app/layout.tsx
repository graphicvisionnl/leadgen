import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Lead Gen — Graphic Vision',
  description: 'Lead generation pipeline dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={plusJakarta.variable}>
      <body className="bg-dark text-white font-sans antialiased min-h-screen">
        <nav className="border-b border-subtle bg-dark/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z" fill="white" fillOpacity="0.9"/>
                </svg>
              </div>
              <span className="font-semibold text-sm">Graphic Vision</span>
              <span className="text-white/30 text-sm">/</span>
              <span className="text-white/50 text-sm">Lead Gen</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <Link href="/" className="text-white/60 hover:text-white transition-colors">
                Dashboard
              </Link>
              <Link href="/settings" className="text-white/60 hover:text-white transition-colors">
                Instellingen
              </Link>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
