import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { 
  updateBusinessSettingsSchema, 
  validateBody 
} from '@/lib/validation'

export async function GET(request: NextRequest) {
  // Authentication + role: this route used to rely on the middleware alone.
  // The middleware only checks that a session cookie is present; the route
  // itself must verify the token and the caller's role.
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams
    const type = searchParams.get('type')

    if (type === 'business') {
      const { data, error } = await supabase
        .from('business_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return NextResponse.json({ data: data || null })
    }


    if (type === 'easyorders') {
      const { data, error } = await supabase
        .from('easyorders_config')
        .select('*')
        .single()

      if (error && error.code !== 'PGRST116') throw error
      const safeConfig = data ? { ...data, api_key: undefined, webhook_secret: undefined } : null
      return NextResponse.json({ data: safeConfig })
    }

    // Return all settings (AI removed from the product)
    const [business, easyorders] = await Promise.all([
      supabase.from('business_settings').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('easyorders_config').select('*').maybeSingle(),
    ])

    return NextResponse.json({
      business: business.data || null,
      easyorders: easyorders.data ? { ...easyorders.data, api_key: undefined, webhook_secret: undefined } : null,
    })
  } catch (error) {
    console.error('Get settings error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  // Only an administrator may change the business settings.
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  const body = await request.json()
  const { type, ...settings } = body

  if (!type || !['business'].includes(type)) {
    return NextResponse.json({ error: 'Invalid settings type' }, { status: 400 })
  }

  let validation
  if (type === 'business') {
    validation = await validateBody(
      new Request(request.url, { method: 'POST', body: JSON.stringify(settings) }),
      updateBusinessSettingsSchema
    )
  }

  if (validation?.error) return validation.error
  const { data: validatedData, error: validationError } = validation!
  if (validationError) return validationError

  try {
    const supabase = createServiceClient()

    if (type === 'business') {
      // Singleton table: UPDATE the existing row; INSERT only when absent
      const { data: existing } = await supabase
        .from('business_settings')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let saved
      if (existing?.id) {
        const { data, error } = await supabase
          .from('business_settings')
          .update(validatedData as Record<string, unknown>)
          .eq('id', existing.id)
          .select()
          .single()
        if (error) throw error
        saved = data
      } else {
        const { data, error } = await supabase
          .from('business_settings')
          .insert(validatedData as Record<string, unknown>)
          .select()
          .single()
        if (error) throw error
        saved = data
      }
      return NextResponse.json({ success: true, data: saved })
    }


    return NextResponse.json({ error: 'Invalid settings type' }, { status: 400 })
  } catch (error) {
    console.error('Update settings error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    )
  }
}
