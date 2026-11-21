import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createCustomerSchema, validateBody } from '@/lib/validation'
import type { Customer } from '@/types'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import {
  escapeFilterValue,
  isUuid,
  parsePageParams,
  parseSortColumn,
  parseSortOrder,
  sanitizeSearchTerm,
} from '@/lib/api-params'
import { isRangeNotSatisfiable } from '@/lib/supabase/paginate'

/**
 * Columns the list UI is allowed to sort by.
 *
 * An explicit allow-list: PostgREST answers `42703 column … does not exist`
 * for anything else, which used to surface as an HTTP 500.
 */
const CUSTOMER_SORT_COLUMNS = {
  created_at: 'created_at',
  updated_at: 'updated_at',
  name: 'name',
  phone: 'phone',
  email: 'email',
  total_spent: 'total_spent',
  total_orders: 'total_orders',
  last_interaction_at: 'last_interaction_at',
} as const

export async function GET(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams

    const pagination = parsePageParams(searchParams)
    if (!pagination.ok) {
      return NextResponse.json({ error: pagination.error }, { status: 400 })
    }
    const { page, pageSize, offset } = pagination.value

    const search = sanitizeSearchTerm(searchParams.get('search'))
    const customerId = searchParams.get('id')

    if (customerId && !isUuid(customerId)) {
      return NextResponse.json({ error: 'معرف العميل غير صالح' }, { status: 400 })
    }

    const sort = parseSortColumn(searchParams.get('sortBy'), CUSTOMER_SORT_COLUMNS, 'created_at')
    if (!sort.ok) {
      return NextResponse.json({ error: sort.error }, { status: 400 })
    }
    const ascending = parseSortOrder(searchParams.get('sortOrder'))

    // The same filters are applied to the body query and to the count-only
    // query used when the requested page is past the end of the table.
    const applyFilters = (builder: any) => {
      let q = builder
      if (customerId) q = q.eq('id', customerId)
      if (search) {
        // The value is quoted (PostgREST strips the quotes) and sanitised, so
        // a comma, a parenthesis or a quote in the search box cannot change
        // the meaning of the filter expression.
        const pattern = `%${escapeFilterValue(search)}%`
        q = q.or(
          `name.ilike."${pattern}",phone.ilike."${pattern}",email.ilike."${pattern}"`
        )
      }
      return q
    }

    const query = applyFilters(
      supabase.from('customers').select('*', { count: 'exact' })
    )
      .order(sort.value, { ascending })
      .range(offset, offset + pageSize - 1)

    const { data, error, count } = await query

    if (error) {
      // PGRST103: the page starts past the last row. That is an empty page,
      // not a server error — answer 200 with an empty list and the real
      // total so the UI can show "no rows on this page".
      if (isRangeNotSatisfiable(error)) {
        const countOnly = applyFilters(
          supabase.from('customers').select('id', { count: 'exact', head: true })
        )
        const { count: total } = await countOnly
        const totalCount = total ?? 0
        return NextResponse.json({
          data: [],
          total: totalCount,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        })
      }
      throw error
    }

    return NextResponse.json({
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    })
  } catch (error) {
    console.error('Get customers error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch customers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  const validation = await validateBody(request, createCustomerSchema)
  if (validation.error) return validation.error

  const { data, error: validationError } = validation
  if (validationError) return validationError

  try {
    const supabase = createServiceClient()
    const { name, phone, email, address, governorate, city, tags, notes } = data

    // Check if customer already exists
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Customer with this phone number already exists' },
        { status: 400 }
      )
    }

    const { data: newCustomer, error } = await supabase
      .from('customers')
      .insert({
        name,
        phone,
        email,
        address,
        governorate,
        city,
        tags: tags || [],
        notes,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data: newCustomer })
  } catch (error) {
    console.error('Create customer error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create customer' },
      { status: 500 }
    )
  }
}
