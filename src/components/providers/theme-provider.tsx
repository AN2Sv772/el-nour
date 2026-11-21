"use client"

import * as React from "react"
import { ThemeProvider as ClientThemeProvider } from "@/hooks/use-client-theme"

export function ThemeProvider({ children, ...props }: { children: React.ReactNode }) {
  return <ClientThemeProvider {...props}>{children}</ClientThemeProvider>
}