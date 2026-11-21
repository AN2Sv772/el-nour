import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createProductSchema, validateBody } from '@/lib/validation'
import type { Product } from '@/types'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'

export async function GET(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams
    
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const search = searchParams.get('search')
    const stockFilter = searchParams.get('stockFilter')
    const productId = searchParams.get('id')
    const sortBy = searchParams.get('sortBy') || 'created_at'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    // Inactive products are hidden by default (the catalogue shows what can be
    // sold), but they MUST stay reachable: a product that cannot be seen
    // cannot be re-activated, which turns deactivation into a one-way door.
    const includeInactive = searchParams.get('includeInactive') === 'true'

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' })

    if (!includeInactive) query = query.eq('is_active', true)

    if (productId) {
      query = query.eq('id', productId)
    }
    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,name_ar.ilike.%${search}%`)
    }

    if (stockFilter === 'low') {
      query = query.lte('stock_quantity', 10).gt('stock_quantity', 0)
    } else if (stockFilter === 'out') {
      query = query.eq('stock_quantity', 0)
    }

    query = query.order(sortBy, { ascending: sortOrder === 'asc' })
    
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

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
