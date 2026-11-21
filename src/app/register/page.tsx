"use client"

import * as React from "react"
import { useState } from "react"
import { Loader2, Mail, Lock, AlertCircle, Eye, EyeOff, CheckCircle, User } from "lucide-react"
import { useRouter } from "next/navigation"

function RegisterForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordStrength, setPasswordStrength] = useState(0)

  const checkStrength = (pw: string) => {
    let score = 0
    if (pw.length >= 8) score++
    if (/[A-Z]/.test(pw)) score++
    if (/[a-z]/.test(pw)) score++
    if (/[0-9]/.test(pw)) score++
    if (/[^A-Za-z0-9]/.test(pw)) score++
    return score
  }

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // Read form values synchronously — React nulls `currentTarget` after the
    // sync handler completes; reading it after an `await` would throw.
    const formData = new FormData(e.currentTarget)
    const fullName = (formData.get("fullName") as string)?.trim()
    const email = (formData.get("email") as string)?.trim().toLowerCase()
    const password = formData.get("password") as string
    const confirmPassword = formData.get("confirmPassword") as string

    setError("")
    setLoading(true)

    try {
      if (password !== confirmPassword) {
        setError("كلمة المرور غير متطابقة")
        setLoading(false)
        return
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, password, confirmPassword }),
      })

      const result = await response.json()

      if (!response.ok) {
        setError(result.error || "فشل إنشاء الحساب")
        return
      }

      if (result.success) {
        setSuccess(true)
        setTimeout(() => router.push("/login"), 2000)
      } else {
        setError(result.error || "فشل إنشاء الحساب")
      }
    } catch {
      setError("حدث خطأ. تحقق من اتصالك بالإنترنت.")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <main id="main-content" className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">تم إنشاء الحساب!</h1>
          <p className="text-muted-foreground text-sm mb-6">
            حسابك جاهز. جاري تحويلك لصفحة تسجيل الدخول...
          </p>
          <div className="mx-auto h-1 w-32 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-[slide-in-right_2s_ease-out_forwards]" style={{ width: "100%" }} />
          </div>
        </div>
      </main>
    )
  }

  return (
    <main id="main-content" className="min-h-screen bg-background flex" dir="rtl">
      {/* Left visual panel */}
      <div className="hidden lg:flex lg:w-[45%] bg-primary items-center justify-center relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-16 w-[28rem] h-[28rem] rounded-full bg-white/5" />
        <div className="relative z-10 text-center px-12">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm shadow-lg">
            <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10 text-white" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">منصة النور</h1>
          <p className="text-primary-foreground/80 text-base leading-relaxed max-w-sm">
            أنشئ حسابك وابدأ في إدارة طلباتك وعملائك بذكاء وكفاءة
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 overflow-y-auto">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">إنشاء حساب جديد</h2>
            <p className="text-muted-foreground mt-1.5 text-sm">املأ البيانات أدناه للبدء</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
            <form onSubmit={handleRegister} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-destructive/8 border border-destructive/20 p-3 text-sm text-destructive animate-fade-in">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Full Name */}
              <div className="space-y-1.5">
                <label htmlFor="fullName" className="block text-sm font-medium text-foreground">
                  الاسم الكامل
                </label>
                <div className="relative">
                  <User className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    required
                    disabled={loading}
                    placeholder="محمد أحمد"
                    className="w-full h-11 rounded-xl border border-input bg-background pl-4 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                  />
                </div>
              </div>

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
                    disabled={loading}
                    autoComplete="email"
                    placeholder="name@company.com"
                    className="w-full h-11 rounded-xl border border-input bg-background pl-4 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-foreground">
                  كلمة المرور
                </label>
                <div className="relative">
                  <Lock className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    disabled={loading}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="w-full h-11 rounded-xl border border-input bg-background pl-10 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
                    dir="ltr"
                    onChange={(e) => setPasswordStrength(checkStrength(e.target.value))}
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
                {/* Strength indicator */}
                {passwordStrength > 0 && (
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i <= passwordStrength
                            ? passwordStrength <= 2
                              ? "bg-red-400"
                              : passwordStrength <= 3
                                ? "bg-amber-400"
                                : "bg-primary"
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  8 أحرف على الأقل، حرف كبير + حرف صغير + رقم
                </p>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">
                  تأكيد كلمة المرور
                </label>
                <div className="relative">
                  <Lock className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    required
                    disabled={loading}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="w-full h-11 rounded-xl border border-input bg-background pl-10 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-ring transition-colors disabled:opacity-50"
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

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm hover:bg-primary/90 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري إنشاء الحساب...
                  </>
                ) : (
                  "إنشاء الحساب"
                )}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            لديك حساب بالفعل؟{" "}
            <a href="/login" className="font-semibold text-primary hover:underline">
              تسجيل الدخول
            </a>
          </p>
        </div>
      </div>
    </main>
  )
}

export default function RegisterPage() {
  return <RegisterForm />
}
