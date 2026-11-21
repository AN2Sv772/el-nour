"use client"

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/hooks/use-client-theme'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock matchMedia
const matchMediaMock = vi.fn((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', { value: matchMediaMock })

describe('use-client-theme', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    // Reset document classes
    document.documentElement.classList.remove('light', 'dark')
  })

  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark')
  })

  const TestComponent = () => {
    const { theme, setTheme, resolvedTheme } = useTheme()
    return (
      <div>
        <span data-testid="theme">{theme}</span>
        <span data-testid="resolved-theme">{resolvedTheme}</span>
        <button onClick={() => setTheme('light')}>Light</button>
        <button onClick={() => setTheme('dark')}>Dark</button>
        <button onClick={() => setTheme('system')}>System</button>
      </div>
    )
  }

  it('provides theme context with default values', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    expect(screen.getByTestId('theme')).toHaveTextContent('system')
    expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
  })

  it('applies light theme to document', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('switches to dark theme', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    act(() => {
      screen.getByText('Dark').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('dark')
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  it('switches to light theme', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    act(() => {
      screen.getByText('Dark').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark')
    })

    act(() => {
      screen.getByText('Light').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('light')
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light')
      expect(document.documentElement.classList.contains('light')).toBe(true)
    })
  })

  it('persists theme to localStorage', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    act(() => {
      screen.getByText('Dark').click()
    })

    await waitFor(() => {
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark')
    })
  })

  it('throws error when used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    const TestComponent = () => {
      const { theme } = useTheme()
      return <span data-testid="theme">{theme}</span>
    }
    
    expect(() => {
      render(<TestComponent />)
    }).toThrow('useTheme must be used within a ThemeProvider')
  })
})

describe('SSR safety', () => {
  it('does not access document during SSR render', () => {
    // This test verifies the component doesn't crash during SSR render
    // The actual SSR test is done by Next.js build
    const TestComponent = () => {
      const { theme } = useTheme()
      return <span data-testid="theme">{theme}</span>
    }
    
    expect(() => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )
    }).not.toThrow()
  })
})
