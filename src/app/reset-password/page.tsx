"use client"

import * as React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, AlertCircle, CheckCircle, Eye, EyeOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // Read synchronously before any await (React nulls currentTarget after)
    const formData = new FormData(e.currentTarget)
    const password = formData.get("password") as string
    const confirmPassword = formData.get("confirmPassword") as string

    if (password !== confirmPassword) {
      setError("كلمة المرور غير متطابقة")
      return
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم")
      return
    }

    setLoading(true)
    setError("")

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setError(error.message || "فشل تحديث كلمة المرور")
        return
      }
      setSuccess(true)
      setTimeout(() => router.push("/dashboard"), 2000)
    } catch {
      setError("حدث خطأ. تحقق من اتصالك بالإنترنت.")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">تم تحديث كلمة المرور!</h1>
          <p className="text-muted-foreground text-sm">جاري تحويلك للوحة التحكم...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground">تعيين كلمة مرور جديدة</h2>
          <p className="text-muted-foreground mt-1.5 text-sm">أدخل كلمة المرور الجديدة الخاصة بك</p>
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
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                كلمة المرور الجديدة
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="w-full h-11 rounded-xl border border-input bg-background pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                  dir="ltr"
                />
                <button
                  type="button"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "إخفاء" : "إظهار"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">
                تأكيد كلمة المرور
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="w-full h-11 rounded-xl border border-input bg-background pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                  dir="ltr"
                />
                <button
                  type="button"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowConfirm(!showConfirm)}
                  aria-label={showConfirm ? "إخفاء" : "إظهار"}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
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
                  جاري الحفظ...
                </>
              ) : (
                "تحديث كلمة المرور"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
