"use client"

import * as React from "react"
import { useState } from "react"
import { Loader2, Mail, Lock, AlertCircle, Eye, EyeOff } from "lucide-react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/providers/auth-provider"

function LoginForm() {
  const router = useRouter()
  const { signOut } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // IMPORTANT: read form values synchronously — React nulls `currentTarget`
    // after the synchronous event handler completes, so accessing it after
    // any `await` throws "parameter 1 is not of type 'HTMLFormElement'".
    const formData = new FormData(e.currentTarget)
    const email = (formData.get("email") as string)?.trim()
    const password = formData.get("password") as string

    setLoading(true)
    setError("")

    try {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()

      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        const msg = error.message?.toLowerCase() || ""
        if (msg.includes("invalid") || msg.includes("wrong") || msg.includes("credentials")) {
          setError("البريد الإلكتروني أو كلمة المرور غير صحيحة")
        } else if (msg.includes("not confirmed") || msg.includes("email not confirmed")) {
          setError("لم يتم تأكيد الحساب بعد. تحقق من بريدك الإلكتروني.")
        } else if (msg.includes("rate limit") || msg.includes("too many")) {
          setError("محاولات كثيرة جداً. يرجى الانتظار قليلاً والمحاولة مرة أخرى.")
        } else {
          setError(error.message || "فشل تسجيل الدخول. حاول مرة أخرى.")
        }
        return
      }

      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      console.error("Login error:", err)
      setError("حدث خطأ. تحقق من اتصالك بالإنترنت.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main id="main-content" className="min-h-screen bg-background flex" dir="rtl">
      {/* ─── Left Panel (Visual) ─────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] items-center justify-center relative overflow-hidden bg-[hsl(152_57%_12%)]">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-16 w-[28rem] h-[28rem] rounded-full bg-white/5" />
        <div className="absolute top-1/3 right-1/4 w-40 h-40 rounded-full bg-white/5" />

        <div className="relative z-10 text-center px-12">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm shadow-lg">
            <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10 text-white" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">منصة النور</h1>
          <p className="text-primary-foreground/80 text-base leading-relaxed max-w-sm">
            أدر طلباتك وعملائك من مكان واحد — بذكاء وكفاءة
          </p>
          <div className="mt-8 flex items-center justify-center gap-2 text-primary-foreground/60 text-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/40" />
            <span>مزامنة تلقائية</span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/40 mx-2" />
            <span>ردود ذكية</span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/40 mx-2" />
            <span>تقارير فورية</span>
          </div>
        </div>
      </div>

      {/* ─── Right Panel (Form) ──────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile Logo */}
          <div className="lg:hidden flex flex-col items-center mb-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25 mb-4">
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-white" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-foreground">منصة النور</h1>
            <p className="text-muted-foreground text-sm mt-1">أدر طلباتك بذكاء</p>
          </div>

          {/* Desktop heading */}
          <div className="hidden lg:block mb-8">
            <h2 className="text-2xl font-bold text-foreground">مرحباً بعودتك 👋</h2>
            <p className="text-muted-foreground mt-1.5 text-sm">سجّل دخولك للمتابعة إلى لوحة التحكم</p>
          </div>

          {/* Form Card */}
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
            <form onSubmit={handleLogin} className="space-y-5">
              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-destructive/8 border border-destructive/20 p-3 text-sm text-destructive animate-fade-in">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Email */}
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
                    autoComplete="email"
                    disabled={loading}
                    placeholder="name@company.com"
                    className="w-full h-11 rounded-xl border border-input bg-background pl-4 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-foreground">
                    كلمة المرور
                  </label>
                  <a href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                    نسيت كلمة المرور؟
                  </a>
                </div>
                <div className="relative">
                  <Lock className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    disabled={loading}
                    placeholder="••••••••"
                    className="w-full h-11 rounded-xl border border-input bg-background pl-10 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm hover:bg-primary/90 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري تسجيل الدخول...
                  </>
                ) : (
                  "تسجيل الدخول"
                )}
              </button>
            </form>
          </div>

          {/* Register link */}
          <p className="mt-6 text-center text-sm text-muted-foreground">
            ليس لديك حساب؟{" "}
            <a href="/register" className="font-semibold text-primary hover:underline">
              أنشئ حساباً جديداً
            </a>
          </p>
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return <LoginForm />
}
