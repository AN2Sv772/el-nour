"use client"

import { createContext, useContext, useEffect, useState, useRef, createElement, useCallback } from "react"

export type Theme = "light" | "dark" | "system"

export interface ThemeContextType {
  /** The selected preference (may be "system"). */
  theme: Theme
  setTheme: (theme: Theme) => void
  /** The theme that is ACTUALLY applied right now ("system" resolved). */
  resolvedTheme: "light" | "dark"
  /** False during the first render — used to avoid hydration mismatches. */
  mounted: boolean
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function ThemeProviderComponent({
  value,
  children,
}: {
  value: ThemeContextType
  children: React.ReactNode
}) {
  return createElement(ThemeContext.Provider, { value }, children)
}

export const THEME_STORAGE_KEY = "theme"

/**
 * Resolve a preference into the theme that must be applied.
 * Exported so the pre-paint script and the tests share one implementation.
 */
export function resolveTheme(preference: Theme, systemPrefersDark: boolean): "light" | "dark" {
  if (preference === "system") return systemPrefersDark ? "dark" : "light"
  return preference
}

export function applyThemeToDocument(t: Theme): "light" | "dark" {
  const resolved = resolveTheme(t, window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.remove("light", "dark")
  document.documentElement.classList.add(resolved)
  document.documentElement.style.colorScheme = resolved
  return resolved
}

/**
 * The theme provider.
 *
 * FIXES (the previous implementation had all three):
 *
 *  1. The stored theme was read in an effect, so the first paint always used
 *     the default theme and then FLIPPED — a visible flash. The document
 *     class is now applied by a pre-paint inline script in the root layout,
 *     and this provider adopts that state on mount.
 *  2. The `prefers-color-scheme` listener had an EMPTY body, so with the
 *     theme set to "system" the UI never followed the operating system when
 *     it changed at sunset. It now re-applies the theme.
 *  3. `resolvedTheme` was not exposed correctly for the "system" preference,
 *     so the toggle button showed the MOON while the page was already dark.
 *     The button now uses `resolvedTheme`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")
  const [mounted, setMounted] = useState(false)
  const mediaQueryRef = useRef<MediaQueryList | null>(null)

  // Adopt the theme that the pre-paint script already applied.
  useEffect(() => {
    const stored = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "system"
    setThemeState(stored)

    const isDark = document.documentElement.classList.contains("dark")
    setResolvedTheme(isDark ? "dark" : "light")
    setMounted(true)
  }, [])

  // Apply the theme and keep it in sync with the operating system.
  useEffect(() => {
    if (!mounted) return

    localStorage.setItem(THEME_STORAGE_KEY, theme)
    const resolved = applyThemeToDocument(theme)
    setResolvedTheme(resolved)

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    mediaQueryRef.current = mediaQuery

    const handleChange = (event: MediaQueryListEvent) => {
      // Only the "system" preference follows the OS; an explicit choice
      // stays where the user put it.
      setThemeState((current) => {
        if (current !== "system") return current
        const next: "light" | "dark" = event.matches ? "dark" : "light"
        document.documentElement.classList.remove("light", "dark")
        document.documentElement.classList.add(next)
        document.documentElement.style.colorScheme = next
        setResolvedTheme(next)
        return current
      })
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => {
      mediaQuery.removeEventListener("change", handleChange)
      mediaQueryRef.current = null
    }
  }, [theme, mounted])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
  }, [])

  const value = {
    theme,
    setTheme,
    resolvedTheme,
    mounted,
  }

  return createElement(ThemeProviderComponent, { value, children })
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

/**
 * The script that applies the stored theme BEFORE the first paint.
 *
 * It is injected into the root layout as a blocking inline script. Without
 * it the page renders in the default theme and then flips — a flash of the
 * wrong theme on every navigation.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system';
    var dark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`
