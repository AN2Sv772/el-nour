import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { registerSchema, validateBody } from '@/lib/validation'

/**
 * Server-side registration endpoint.
 * Creates Supabase Auth user + user_profiles record.
 * Email confirmation is NOT required — user can log in immediately.
 *
 * SELF-REGISTRATION IS ALLOW-LIST ONLY
 * ------------------------------------
 * This endpoint used to mint an `employee` account for anybody who posted to
 * it. `employee` can create orders, edit prices, adjust stock and export
 * every customer's name, phone and address. On a publicly reachable
 * deployment that is an open door, and the database trigger that creates the
 * profile row did the same.
 *
 * Registering as `viewer` is NOT a fix: `viewer` still reads the customer
 * PII. The server has to decide who may register:
 *
 *   REGISTRATION_ALLOWED_EMAILS   comma-separated list of addresses
 *
 * With the variable unset, registration is CLOSED (HTTP 403). With it set,
 * only the listed addresses may register, and they are created as `employee`
 * — the role the owner intends for a trusted member of staff.
 */

/** The addresses allowed to self-register, or `null` when registration is closed. */
function allowedRegistrationEmails(): Set<string> | null {
  const raw = process.env.REGISTRATION_ALLOWED_EMAILS
  if (!raw) return null
  const list = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 ? new Set(list) : null
}

export async function POST(request: NextRequest) {
  const validation = await validateBody(request, registerSchema)
  if (validation.error) return validation.error

  const { data, error: validationError } = validation
  if (validationError) return validationError

  const { fullName, email, password } = data

  const allowed = allowedRegistrationEmails()
  if (!allowed) {
    return NextResponse.json(
      { error: 'التسجيل الذاتي مغلق — راجع مدير النظام لإضافة حساب.' },
      { status: 403 }
    )
  }
  if (!allowed.has(email.toLowerCase())) {
    return NextResponse.json(
      { error: 'هذا البريد الإلكتروني غير مُصرّح له بالتسجيل — راجع مدير النظام.' },
      { status: 403 }
    )
  }

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
      // Upsert, not insert: the `handle_new_user` trigger may have already
      // created the row with its own default role, and the trigger's row is
      // the one that would otherwise grant the role. This route is the
      // authority, so it overwrites whatever the trigger wrote.
      const { error: profileError } = await supabase
        .from('user_profiles')
        .upsert(
          {
            id: authData.user.id,
            email,
            full_name: fullName,
            role: 'employee',
            is_active: true,
          },
          { onConflict: 'id' }
        )

      if (profileError) {
        // The account exists but its profile could not be written. Leave it
        // inactive rather than letting it keep the trigger's default role.
        console.error('Profile creation error:', profileError)
        await supabase
          .from('user_profiles')
          .update({ role: 'viewer', is_active: false })
          .eq('id', authData.user.id)
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
