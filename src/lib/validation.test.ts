import { describe, it, expect } from 'vitest'
import { 
  createCustomerSchema, 
  createProductSchema, 
  createOrderSchema, 
  updateBusinessSettingsSchema,
} from '@/lib/validation'

describe('createCustomerSchema', () => {
  it('validates a complete customer object', () => {
    const result = createCustomerSchema.parse({
      name: 'Ahmed Mohamed',
      phone: '01234567890',
      email: 'ahmed@example.com',
      address: 'Cairo, Egypt',
      governorate: 'Cairo',
      city: 'Cairo',
      tags: ['vip'],
      notes: 'Good customer',
    })
    expect(result.name).toBe('Ahmed Mohamed')
    expect(result.phone).toBe('01234567890')
  })

  it('requires name', () => {
    expect(() => createCustomerSchema.parse({ name: '', phone: '01234567890' })).toThrow()
  })

  it('requires phone', () => {
    expect(() => createCustomerSchema.parse({ name: 'Ahmed', phone: '' })).toThrow()
  })

  it('validates email format', () => {
    expect(() => createCustomerSchema.parse({ name: 'Ahmed', phone: '01234567890', email: 'invalid-email' })).toThrow()
  })
})

describe('createProductSchema', () => {
  it('validates a complete product object', () => {
    const result = createProductSchema.parse({
      name: 'Test Product',
      sku: 'PROD-001',
      price: 99.99,
      stock_quantity: 100,
    })
    expect(result.name).toBe('Test Product')
    expect(result.sku).toBe('PROD-001')
    expect(result.price).toBe(99.99)
  })

  it('requires name and SKU', () => {
    expect(() => createProductSchema.parse({ name: '', sku: 'PROD-001' })).toThrow()
    expect(() => createProductSchema.parse({ name: 'Test', sku: '' })).toThrow()
  })

  it('validates price is non-negative', () => {
    expect(() => createProductSchema.parse({ name: 'Test', sku: 'PROD-001', price: -1 })).toThrow()
  })

  it('defaults stock_quantity to 0', () => {
    const result = createProductSchema.parse({ name: 'Test', sku: 'PROD-001', price: 10 })
    expect(result.stock_quantity).toBe(0)
  })
})

describe('createOrderSchema', () => {
  it('validates a complete order object', () => {
    const result = createOrderSchema.parse({
      customer_id: '550e8400-e29b-41d4-a716-446655440000',
      items: [{
        product_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        product_name: 'Test Product',
        sku: 'PROD-001',
        quantity: 2,
        unit_price: 50.00,
        total_price: 100.00,
      }],
      shipping_address: {
        name: 'Ahmed Mohamed',
        phone: '01234567890',
        address: '123 Main St',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    })
    expect(result.customer_id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(result.items).toHaveLength(1)
    expect(result.payment_method).toBe('cash_on_delivery')
  })

  it('requires customer_id', () => {
    expect(() => createOrderSchema.parse({ customer_id: '', items: [] })).toThrow()
  })

  it('requires at least one item', () => {
    expect(() => createOrderSchema.parse({ customer_id: '550e8400-e29b-41d4-a716-446655440000', items: [] })).toThrow()
  })

  it('validates shipping address', () => {
    expect(() => createOrderSchema.parse({
      customer_id: '550e8400-e29b-41d4-a716-446655440000',
      items: [{ product_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', product_name: 'Test', sku: 'PROD-001', quantity: 1, unit_price: 10, total_price: 10 }],
      shipping_address: { name: '', phone: '', address: '', city: '', governorate: '' },
    })).toThrow()
  })
})

describe('updateBusinessSettingsSchema', () => {
  it('validates business settings', () => {
    const result = updateBusinessSettingsSchema.parse({
      business_name: 'El Nour',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
    })
    expect(result.business_name).toBe('El Nour')
    expect(result.currency).toBe('EGP')
  })

  it('validates tax_rate range', () => {
    expect(() => updateBusinessSettingsSchema.parse({ business_name: 'Test', currency: 'EGP', timezone: 'Africa/Cairo', tax_rate: 150 })).toThrow()
  })
})

