import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { AppNav } from '@/components/AppNav'
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
        <AppNav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
