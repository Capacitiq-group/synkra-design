import type { Metadata, Viewport } from 'next'
import { Outfit } from 'next/font/google'
import './globals.css'
import './synkra-theme.css'

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Synkra Design — all-in-one design studio',
  description:
    'Synkra Design is a browser-based design studio: posters, social posts, stories, slides, invitations, resumes, thumbnails and business cards. Start from a template or a blank page, edit everything, and export PNG, JPG, SVG, PDF, MP4 or GIF.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Synkra Design — all-in-one design studio',
    description: 'Design posters, posts, slides and more in your browser. Free, no account needed to start.',
    images: ['/og-image.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#15161A',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${outfit.variable} antialiased`} style={{ fontFamily: 'var(--font-outfit), Outfit, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
