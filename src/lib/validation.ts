import { z } from 'zod'

// Customer validation schemas
export const createCustomerSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب').max(255),
  phone: z.string().min(1, 'رقم الهاتف مطلوب').max(20),
  email: z.string().email('البريد الإلكتروني غير صحيح').optional().nullable(),
  address: z.string().optional().nullable(),
  governorate: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  notes: z.string().optional().nullable(),
})

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().min(1).max(20).optional(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  governorate: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional().nullable(),
})

// Product validation schemas
export const createProductSchema = z.object({
  name: z.string().min(1, 'اسم المنتج مطلوب').max(255),
  name_ar: z.string().max(255).optional().nullable(),
  sku: z.string().min(1, 'SKU مطلوب').max(100),
  category: z.string().optional().nullable(),
  price: z.number().min(0, 'السعر يجب أن يكون رقماً موجباً'),
  compare_at_price: z.number().min(0).optional().nullable(),
  cost_price: z.number().min(0).optional().nullable(),
  stock_quantity: z.number().int().min(0, 'المخزون يجب أن يكون رقماً صحيحاً موجباً').optional().default(0),
  low_stock_threshold: z.number().int().min(0).optional().default(5),
  track_inventory: z.boolean().optional().default(true),
  description: z.string().optional().nullable(),
  description_ar: z.string().optional().nullable(),
  images: z.array(z.string()).optional().default([]),
  variants: z.array(z.unknown()).optional().default([]),
})

export const updateProductSchema = createProductSchema.partial()

/**
 * The exact set of fields PATCH /api/products/[id] may write.
 *
 * A dedicated schema rather than `updateProductSchema` on purpose: the
 * allow-list is a privilege decision (stock, images and variants are NOT
 * editable here), and the values need a bound so a negative price or cost
 * cannot reach the database — a negative `cost_price` is snapshotted onto
 * every future order line and inflates the reported margin by that amount.
 */
export const patchProductSchema = z.object({
  name: z.string().min(1, 'اسم المنتج مطلوب').max(255).optional(),
  name_ar: z.string().max(255).optional().nullable(),
  sku: z.string().min(1, 'SKU مطلوب').max(100).optional(),
  category: z.string().optional().nullable(),
  price: z.number().min(0, 'السعر يجب أن يكون رقماً موجباً').max(99_999_999.99).optional(),
  cost_price: z.number().min(0, 'التكلفة يجب أن تكون رقماً موجباً').max(99_999_999.99).optional().nullable(),
  low_stock_threshold: z.number().int().min(0, 'حد إعادة الطلب يجب أن يكون رقماً صحيحاً موجباً').optional(),
  description: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
  track_inventory: z.boolean().optional(),
})

// Order validation schemas
export const createOrderSchema = z.object({
  customer_id: z.string().uuid('معرف العميل غير صحيح'),
  items: z.array(
    z.object({
      product_id: z.string().uuid('معرف المنتج غير صحيح'),
      variant_id: z.string().uuid().optional().nullable(),
      product_name: z.string().min(1, 'اسم المنتج مطلوب'),
      product_name_ar: z.string().optional().nullable(),
      sku: z.string().min(1, 'SKU مطلوب'),
      variant_name: z.string().optional().nullable(),
      quantity: z.number().int().min(1, 'الكمية يجب أن تكون رقماً صحيحاً موجباً'),
      unit_price: z.number().min(0, 'سعر الوحدة يجب أن يكون رقماً موجباً'),
      discount: z.number().min(0).optional().default(0),
      total_price: z.number().min(0, 'الإجمالي يجب أن يكون رقماً موجباً'),
    })
  ).min(1, 'يجب إضافة منتج واحد على الأقل'),
  shipping_address: z.object({
    name: z.string().min(1, 'اسم المستلم مطلوب'),
    phone: z.string().min(1, 'رقم الهاتف مطلوب'),
    address: z.string().min(1, 'العنوان مطلوب'),
    city: z.string().min(1, 'المدينة مطلوبة'),
    governorate: z.string().min(1, 'المحافظة مطلوبة'),
    postal_code: z.string().optional().nullable(),
    landmark: z.string().optional().nullable(),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).optional().nullable(),
  }),
  billing_address: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    address: z.string().min(1),
    city: z.string().min(1),
    governorate: z.string().min(1),
    postal_code: z.string().optional().nullable(),
    landmark: z.string().optional().nullable(),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).optional().nullable(),
  }).optional().nullable(),
  payment_method: z.enum(['cash_on_delivery', 'card', 'bank_transfer', 'wallet', 'other']).optional().default('cash_on_delivery'),
  shipping_fee: z.number().min(0).optional().default(0),
  discount_amount: z.number().min(0).optional().default(0),
  tax_amount: z.number().min(0).optional().default(0),
  notes: z.string().optional().nullable(),
  source: z.string().optional().default('manual'),
})

export const updateOrderSchema = z.object({
  status: z.enum([
    'pending', 'awaiting_confirmation', 'confirmed', 'preparing',
    'ready_for_shipping', 'shipped', 'out_for_delivery', 'delivered',
    'cancelled', 'returned', 'failed_delivery'
  ]).optional(),
  notes: z.string().optional().nullable(),
  tracking_number: z.string().optional().nullable(),
  shipping_company: z.string().optional().nullable(),
  cancellation_reason: z.string().optional().nullable(),
})

// Registration validation schemas
export const registerSchema = z.object({
  fullName: z.string().min(1, 'الاسم الكامل مطلوب').max(255, 'الاسم الكامل طويل جداً'),
  email: z.string().email('البريد الإلكتروني غير صحيح').min(1, 'البريد الإلكتروني مطلوب'),
  password: z.string()
    .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .max(128, 'كلمة المرور طويلة جداً')
    .regex(/[A-Z]/, 'يجب أن تحتوي كلمة المرور على حرف كبير واحد على الأقل')
    .regex(/[a-z]/, 'يجب أن تحتوي كلمة المرور على حرف صغير واحد على الأقل')
    .regex(/[0-9]/, 'يجب أن تحتوي كلمة المرور على رقم واحد على الأقل'),
  confirmPassword: z.string().min(1, 'تأكيد كلمة المرور مطلوب'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "كلمة المرور غير متطابقة",
  path: ["confirmPassword"],
})

export const loginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صحيح').min(1, 'البريد الإلكتروني مطلوب'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
})

// Settings validation
export const updateBusinessSettingsSchema = z.object({
  business_name: z.string().min(1, 'اسم العمل مطلوب'),
  business_name_ar: z.string().optional().nullable(),
  business_name_en: z.string().optional().nullable(),
  currency: z.string().min(1, 'العملة مطلوبة'),
  timezone: z.string().min(1, 'المنطقة الزمنية مطلوبة'),
  default_shipping_fee: z.number().min(0).optional(),
  free_shipping_threshold: z.number().min(0).optional().nullable(),
  tax_rate: z.number().min(0).max(100, 'معدل الضريبة يجب أن يكون بين 0 و 100').optional(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  website: z.string().url().optional().nullable(),
  primary_color: z.string().optional(),
  secondary_color: z.string().optional(),
})

// Helper to validate request body
export async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ data: T; error: null } | { data: null; error: Response }> {
  try {
    const body = await request.json()
    const data = schema.parse(body)
    return { data, error: null }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues ?? (error as { errors?: z.ZodIssue[] }).errors ?? []
      return {
        data: null,
        error: new Response(
          JSON.stringify({
            error: 'Invalid input',
            details: issues.map((e) => ({
              field: e.path?.join('.') || '',
              message: e.message,
            })),
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        ),
      }
    }
    return {
      data: null,
      error: new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }
}
