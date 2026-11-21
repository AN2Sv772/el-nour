import type { Metadata, Viewport } from "next"
import { IBM_Plex_Sans_Arabic } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { AuthProvider } from "@/components/providers/auth-provider"
import { LanguageProvider, languageInitScript } from "@/lib/i18n/language"
import { themeInitScript } from "@/hooks/use-client-theme"

export const dynamic = 'force-dynamic'

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "النور — إدارة الطلبات والعملاء",
  description: "منصة متكاملة لإدارة الطلبات والعملاء",
  robots: "noindex, nofollow",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#126B45" },
    { media: "(prefers-color-scheme: dark)", color: "#06452F" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme BEFORE the first paint — without this the
            page renders in the default theme and then flips (a visible
            flash of the wrong theme on every navigation). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* The language must be applied BEFORE the first paint too: flipping
            `dir` after the document renders is a visible jump on every
            navigation. */}
        <script dangerouslySetInnerHTML={{ __html: languageInitScript }} />
      </head>
      <body className={`${plexArabic.variable} font-sans antialiased bg-background text-foreground`}>
        {/* Skip link (F-018): the first focusable element on every page. It
            jumps the keyboard user past the sidebar (16 links) to the main
            content. Hidden until focused, then pinned to the top-right
            corner (RTL). */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lg"
        >
          تخطَّ إلى المحتوى الرئيسي
        </a>
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              {children}
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
