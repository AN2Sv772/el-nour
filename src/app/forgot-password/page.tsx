"use client"

import * as React from "react"
import { useState } from "react"
import { Loader2, Mail, AlertCircle, CheckCircle, ArrowRight } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  const handleReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // Read synchronously before any await (React nulls currentTarget after)
    const formData = new FormData(e.currentTarget)
    const email = (formData.get("email") as string)?.trim().toLowerCase()

    setLoading(true)
    setError("")

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (error) {
        setError(error.message || "فشل إرسال رابط إعادة التعيين")
        return
      }
      setSent(true)
    } catch {
      setError("حدث خطأ. تحقق من اتصالك بالإنترنت.")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">تحقق من بريدك الإلكتروني</h1>
          <p className="text-muted-foreground text-sm mb-6">
            أرسلنا رابط إعادة تعيين كلمة المرور. اتبع التعليمات لتعيين كلمة مرور جديدة.
          </p>
          <a
            href="/login"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowRight className="h-4 w-4" />
            العودة لتسجيل الدخول
          </a>
        </div>
      </div>
    )
  }

  return (
    <main id="main-content" className="min-h-screen bg-background flex items-center justify-center px-6 py-12" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          {/* h1 (not h2): the page had no top-level heading and no landmark
              at all (F-018). */}
          <h1 className="text-2xl font-bold text-foreground">نسيت كلمة المرور؟</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
          <form onSubmit={handleReset} className="space-y-5">
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-destructive/8 border border-destructive/20 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  disabled={loading}
                  autoComplete="email"
                  placeholder="name@company.com"
                  className="w-full h-11 rounded-xl border border-input bg-background pl-4 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                  dir="ltr"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm hover:bg-primary/90 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري الإرسال...
                </>
              ) : (
                "إرسال رابط إعادة التعيين"
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          تذكرت كلمة المرور؟{" "}
          <a href="/login" className="font-semibold text-primary hover:underline">
            تسجيل الدخول
          </a>
        </p>
      </div>
    </main>
  )
}
