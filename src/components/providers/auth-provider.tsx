"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import type { User, Session } from "@supabase/supabase-js"

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  refreshSession: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const supabase = createClient()

  const refreshSession = React.useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    setSession(session)
    setUser(session?.user ?? null)
  }, [supabase])

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
  }, [supabase])

  React.useEffect(() => {
    // Guard against the mock client (returned when env vars are missing) which
    // lacks getSession/onAuthStateChange — otherwise the whole app crashes.
    if (typeof supabase.auth.getSession !== "function" ||
        typeof supabase.auth.onAuthStateChange !== "function") {
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  return (
    <AuthContext.Provider value={{ user, session, loading, refreshSession, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
