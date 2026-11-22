import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createProductSchema, validateBody } from '@/lib/validation'
import type { Product } from '@/types'
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

/**
 * Columns the list UI is allowed to sort by.
 *
 * An explicit allow-list: `.order()` appends the column name verbatim, so an
 * unknown column is both a filter-grammar injection point and a 42703 that
 * used to surface as an HTTP 500.
 */
const PRODUCT_SORT_COLUMNS = {
  created_at: 'created_at',
  updated_at: 'updated_at',
  name: 'name',
  sku: 'sku',
  price: 'price',
  cost_price: 'cost_price',
  stock_quantity: 'stock_quantity',
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

    // The search term reaches a PostgREST `.or()` expression, so it is
    // sanitised and quoted: a comma, a parenthesis or a quote in the search
    // box must not be able to rewrite the filter.
    const search = sanitizeSearchTerm(searchParams.get('search'))
    const stockFilter = searchParams.get('stockFilter')
    const productId = searchParams.get('id')
    const sort = parseSortColumn(searchParams.get('sortBy'), PRODUCT_SORT_COLUMNS, 'created_at')
    if (!sort.ok) {
      return NextResponse.json({ error: sort.error }, { status: 400 })
    }
    const ascending = parseSortOrder(searchParams.get('sortOrder'))
    // Inactive products are hidden by default (the catalogue shows what can be
    // sold), but they MUST stay reachable: a product that cannot be seen
    // cannot be re-activated, which turns deactivation into a one-way door.
    const includeInactive = searchParams.get('includeInactive') === 'true'

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' })

    if (!includeInactive) query = query.eq('is_active', true)

    if (productId) {
      if (!isUuid(productId)) {
        return NextResponse.json({ error: 'معرف المنتج غير صالح' }, { status: 400 })
      }
      query = query.eq('id', productId)
    }
    if (search) {
      const pattern = `%${escapeFilterValue(search)}%`
      query = query.or(
        `name.ilike."${pattern}",sku.ilike."${pattern}",name_ar.ilike."${pattern}"`
      )
    }

    if (stockFilter === 'low') {
      query = query.lte('stock_quantity', 10).gt('stock_quantity', 0)
    } else if (stockFilter === 'out') {
      query = query.eq('stock_quantity', 0)
    }

    query = query.order(sort.value, { ascending })
    query = query.range(offset, offset + pageSize - 1)

    const { data, error, count } = await query

    if (error) throw error

    return NextResponse.json({
      data: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    })
  } catch (error) {
    console.error('Get products error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch products' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  const validation = await validateBody(request, createProductSchema)
  if (validation.error) return validation.error

  const { data, error: validationError } = validation
  if (validationError) return validationError

  try {
    const supabase = createServiceClient()
    const { 
      name, name_ar, sku, category, price, compare_at_price, cost_price, 
      stock_quantity, low_stock_threshold, track_inventory, description, description_ar, images, variants 
    } = data

    // Check if SKU already exists
    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('sku', sku)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Product with this SKU already exists' },
        { status: 400 }
      )
    }

    const { data: newProduct, error } = await supabase
      .from('products')
      .insert({
        name,
        name_ar,
        sku,
        category,
        price: price || 0,
        compare_at_price,
        cost_price,
        stock_quantity: stock_quantity || 0,
        low_stock_threshold: low_stock_threshold || 5,
        track_inventory: track_inventory !== false,
        description,
        description_ar,
        images: images || [],
        variants: variants || [],
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data: newProduct })
  } catch (error) {
    console.error('Create product error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create product' },
      { status: 500 }
    )
  }
}
