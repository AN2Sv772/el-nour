"use client"

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

export default function Home() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.push("/dashboard")
      } else {
        router.push("/login")
      }
    }
    checkAuth()
  }, [router, supabase])

  return (
    <main id="main-content" className="min-h-screen flex items-center justify-center">
      {/* The route redirects, so the heading is for assistive technology
          only (F-018): every route needs an h1. */}
      <h1 className="sr-only">منصة النور</h1>
      <div className="animate-pulse text-primary">جاري التحميل...</div>
    </main>
  )
}