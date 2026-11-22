import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { registerSchema } from "@/lib/validation"
import { z } from "zod"

// Mock the service client before importing the API route
const mockAuthAdmin = {
  createUser: vi.fn(),
}

const mockFrom = vi.fn()
const mockInsert = vi.fn()
const mockUpsert = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: mockAuthAdmin,
    },
    from: mockFrom,
  })),
}))

function getZodIssues(error: unknown): z.ZodIssue[] {
  if (error instanceof z.ZodError) {
    return error.issues
  }
  return (error as { issues?: z.ZodIssue[]; errors?: z.ZodIssue[] }).issues ?? 
         (error as { errors?: z.ZodIssue[] }).errors ?? []
}

describe("registerSchema", () => {
  it("accepts valid registration data", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "ahmed@example.com",
      password: "Password123",
      confirmPassword: "Password123",
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty full name", () => {
    const result = registerSchema.safeParse({
      fullName: "",
      email: "ahmed@example.com",
      password: "Password123",
      confirmPassword: "Password123",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = getZodIssues(result.error)
      expect(issues.some((e) => e.path.includes("fullName"))).toBe(true)
    }
  })

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "not-an-email",
      password: "Password123",
      confirmPassword: "Password123",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = getZodIssues(result.error)
      expect(issues.some((e) => e.path.includes("email"))).toBe(true)
    }
  })

  it("rejects password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "ahmed@example.com",
      password: "Pass1",
      confirmPassword: "Pass1",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = getZodIssues(result.error)
      expect(issues.some((e) => e.path.includes("password"))).toBe(true)
    }
  })

  it("rejects password without uppercase letter", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "ahmed@example.com",
      password: "password123",
      confirmPassword: "password123",
    })
    expect(result.success).toBe(false)
  })

  it("rejects password without lowercase letter", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "ahmed@example.com",
      password: "PASSWORD123",
      confirmPassword: "PASSWORD123",
    })
    expect(result.success).toBe(false)
  })

  it("rejects password without number", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "ahmed@example.com",
      password: "Password",
      confirmPassword: "Password",
    })
    expect(result.success).toBe(false)
  })

  it("rejects mismatched passwords", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "ahmed@example.com",
      password: "Password123",
      confirmPassword: "Password456",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = getZodIssues(result.error)
      const confirmError = issues.find((e) => e.path.includes("confirmPassword"))
      expect(confirmError).toBeDefined()
    }
  })

  it("rejects missing required fields", () => {
    const result = registerSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = getZodIssues(result.error)
      const paths = issues.map((e) => e.path.join("."))
      expect(paths).toContain("fullName")
      expect(paths).toContain("email")
      expect(paths).toContain("password")
      expect(paths).toContain("confirmPassword")
    }
  })

  it("trims whitespace from full name", () => {
    const result = registerSchema.safeParse({
      fullName: "  أحمد محمد  ",
      email: "ahmed@example.com",
      password: "Password123",
      confirmPassword: "Password123",
    })
    expect(result.success).toBe(true)
  })

  it("accepts email with subdomain", () => {
    const result = registerSchema.safeParse({
      fullName: "أحمد محمد",
      email: "ahmed@sub.example.com",
      password: "Password123",
      confirmPassword: "Password123",
    })
    expect(result.success).toBe(true)
  })
})

describe("registration API route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Registration is allow-list only; the allow-list is read per-request.
    process.env.REGISTRATION_ALLOWED_EMAILS = "ahmed@example.com, existing@example.com"
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.REGISTRATION_ALLOWED_EMAILS
  })

  it("creates user and profile on valid registration", async () => {
    const { createServiceClient } = await import("@/lib/supabase/service")

    mockAuthAdmin.createUser.mockResolvedValue({
      data: { user: { id: "test-user-id", email: "ahmed@example.com" } },
      error: null,
    })

    mockFrom.mockReturnValue({
      upsert: mockUpsert.mockResolvedValue({ data: null, error: null }),
    })

    const { POST } = await import("@/app/api/auth/register/route")

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "أحمد محمد",
        email: "ahmed@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      }),
    })

    const response = await POST(request as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockAuthAdmin.createUser).toHaveBeenCalledWith({
      email: "ahmed@example.com",
      password: "Password123",
      user_metadata: { full_name: "أحمد محمد" },
      email_confirm: true,
    })
    expect(mockFrom).toHaveBeenCalledWith("user_profiles")
    // Upsert, not insert: the `handle_new_user` trigger may already have
    // written the row, and this route is the authority on its role.
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        id: "test-user-id",
        email: "ahmed@example.com",
        full_name: "أحمد محمد",
        role: "employee",
        is_active: true,
      },
      { onConflict: "id" }
    )
  })

  it("closes registration when the allow-list is unset", async () => {
    delete process.env.REGISTRATION_ALLOWED_EMAILS

    const { POST } = await import("@/app/api/auth/register/route")

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "أحمد محمد",
        email: "ahmed@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      }),
    })

    const response = await POST(request as any)

    expect(response.status).toBe(403)
    // No account is created at all.
    expect(mockAuthAdmin.createUser).not.toHaveBeenCalled()
  })

  it("rejects an email that is not on the allow-list", async () => {
    process.env.REGISTRATION_ALLOWED_EMAILS = "someone-else@example.com"

    const { POST } = await import("@/app/api/auth/register/route")

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "أحمد محمد",
        email: "ahmed@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      }),
    })

    const response = await POST(request as any)

    expect(response.status).toBe(403)
    expect(mockAuthAdmin.createUser).not.toHaveBeenCalled()
  })

  it("demotes the account to an inactive viewer when the profile upsert fails", async () => {
    mockAuthAdmin.createUser.mockResolvedValue({
      data: { user: { id: "test-user-id", email: "ahmed@example.com" } },
      error: null,
    })

    mockUpsert.mockResolvedValue({ data: null, error: { message: "write failed" } })
    // `.update()` returns a filter builder, so `.eq()` has to hang off it.
    mockUpdate.mockReturnValue({ eq: mockEq })
    mockEq.mockResolvedValue({ data: null, error: null })
    mockFrom.mockReturnValue({
      upsert: mockUpsert,
      update: mockUpdate,
    })

    const { POST } = await import("@/app/api/auth/register/route")

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "أحمد محمد",
        email: "ahmed@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      }),
    })

    const response = await POST(request as any)

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({ role: "viewer", is_active: false })
  })

  it("returns 400 for invalid input", async () => {
    const { POST } = await import("@/app/api/auth/register/route")

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "",
        email: "invalid",
        password: "short",
        confirmPassword: "different",
      }),
    })

    const response = await POST(request as any)
    expect(response.status).toBe(400)
  })

  it("returns generic error when auth user creation fails", async () => {
    const { createServiceClient } = await import("@/lib/supabase/service")

    mockAuthAdmin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already exists" },
    })

    const { POST } = await import("@/app/api/auth/register/route")

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: "أحمد محمد",
        email: "existing@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      }),
    })

    const response = await POST(request as any)
    const body = await response.json()

    expect(response.status).toBe(409)
    // Specific error for duplicate email
    expect(body.error).toBe("هذا البريد الإلكتروني مسجل بالفعل. جرّب تسجيل الدخول.")
    // Profile should NOT be created when auth fails
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("handles missing environment variables gracefully", async () => {
    const originalEnv = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = ""

    try {
      const { POST } = await import("@/app/api/auth/register/route")

      const request = new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          fullName: "أحمد محمد",
          email: "ahmed@example.com",
          password: "Password123",
          confirmPassword: "Password123",
        }),
      })

      const response = await POST(request as any)
      // Should return 500 since service client returns mock
      expect(response.status).toBe(500)
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv
    }
  })
})
