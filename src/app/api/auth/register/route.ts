import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { registerSchema, validateBody } from '@/lib/validation'

/**
 * Server-side registration endpoint.
 * Creates Supabase Auth user + user_profiles record.
 * Email confirmation is NOT required — user can log in immediately.
 */
export async function POST(request: NextRequest) {
  const validation = await validateBody(request, registerSchema)
  if (validation.error) return validation.error

  const { data, error: validationError } = validation
  if (validationError) return validationError

  const { fullName, email, password } = data

  try {
    const supabase = createServiceClient()

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        full_name: fullName,
      },
      // Auto-confirm so the user can log in immediately without email verification
      email_confirm: true,
    })

    if (authError) {
      // Check for specific duplicate email error to give clearer feedback
      const msg = authError.message?.toLowerCase() || ''
      if (msg.includes('already') || msg.includes('duplicate') || msg.includes('registered')) {
        return NextResponse.json(
          { error: 'هذا البريد الإلكتروني مسجل بالفعل. جرّب تسجيل الدخول.' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'فشل إنشاء الحساب. يرجى المحاولة مرة أخرى.' },
        { status: 400 }
      )
    }

    if (authData.user) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          id: authData.user.id,
          email,
          full_name: fullName,
          role: 'employee',
          is_active: true,
        })

      if (profileError) {
        // The on_auth_user_created trigger may have already created it — that's fine
        if (!profileError.message?.includes('duplicate')) {
          console.error('Profile creation error:', profileError)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'تم إنشاء الحساب بنجاح. يمكنك تسجيل الدخول الآن.',
      requiresEmailConfirmation: false,
    })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'فشل إنشاء الحساب. يرجى المحاولة مرة أخرى.' },
      { status: 500 }
    )
  }
}
