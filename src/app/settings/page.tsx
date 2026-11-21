"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Loader2, Save, CheckCircle, AlertCircle, Building , Settings } from 'lucide-react'

interface BusinessSettings {
  business_name: string
  business_name_ar: string
  business_name_en: string
  currency: string
  timezone: string
  default_shipping_fee: number
  free_shipping_threshold: number
  tax_rate: number
  address: string
  phone: string
  email: string
  website: string
  primary_color: string
  secondary_color: string
}

const defaultBusinessSettings: BusinessSettings = {
  business_name: "El Nour Dashboard",
  business_name_ar: "داشبورد النور",
  business_name_en: "El Nour Dashboard",
  currency: "EGP",
  timezone: "Africa/Cairo",
  default_shipping_fee: 30,
  free_shipping_threshold: 500,
  tax_rate: 14,
  address: "",
  phone: "",
  email: "",
  website: "",
  primary_color: "#126B45",
  secondary_color: "#06452F",
}

export default function SettingsPage() {
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(defaultBusinessSettings)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")
  const [saveMessage, setSaveMessage] = useState("")
  const [loading, setLoading] = useState(true)

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const { business } = await response.json()
        if (business) setBusinessSettings({ ...defaultBusinessSettings, ...business })
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    loadSettings()
  }, [loadSettings])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus("idle")
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: "business", ...businessSettings }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'فشل حفظ الإعدادات')
      }

      setSaveStatus("success")
      setSaveMessage("تم حفظ الإعدادات بنجاح")
      setTimeout(() => setSaveStatus("idle"), 3000)
    } catch (error) {
      setSaveStatus("error")
      setSaveMessage(error instanceof Error ? error.message : 'حدث خطأ أثناء الحفظ')
      setTimeout(() => setSaveStatus("idle"), 4000)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <PageHeader
            icon={Settings}
            title="الإعدادات"
            description="إعدادات العمل الأساسية."
          />
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-2 text-muted-foreground">جاري تحميل الإعدادات...</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        <PageHeader
          icon={Settings}
          title="الإعدادات"
          description="إعدادات العمل الأساسية."
        />

        {saveStatus !== "idle" && (
          <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
              saveStatus === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"
                : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
            }`}
            role="status"
          >
            {saveStatus === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{saveMessage}</span>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building className="h-4 w-4 text-muted-foreground" />
              معلومات العمل الأساسية
            </CardTitle>
            <CardDescription>معلومات تظهر في الفواتير والتواصل مع العملاء</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="settings-business-name-ar">اسم العمل (العربي) *</Label>
                <Input
                  id="settings-business-name-ar"
                  value={businessSettings.business_name_ar}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, business_name_ar: e.target.value })}
                  placeholder="داشبورد النور"
                />
              </div>
              <div>
                <Label htmlFor="settings-business-name-en">اسم العمل (الإنجليزي)</Label>
                <Input
                  id="settings-business-name-en"
                  value={businessSettings.business_name_en}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, business_name_en: e.target.value })}
                  placeholder="El Nour Dashboard"
                />
              </div>
              <div>
                <Label htmlFor="settings-currency">العملة</Label>
                <Input
                  id="settings-currency"
                  value={businessSettings.currency}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, currency: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="settings-timezone">المنطقة الزمنية</Label>
                <Input
                  id="settings-timezone"
                  value={businessSettings.timezone}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, timezone: e.target.value })}
                />
              </div>
            </div>
            <Separator />
            <div>
              <Label htmlFor="settings-address">العنوان</Label>
              <Textarea
                id="settings-address"
                value={businessSettings.address}
                onChange={(e) => setBusinessSettings({ ...businessSettings, address: e.target.value })}
                rows={2}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="settings-phone">الهاتف</Label>
                <Input
                  id="settings-phone"
                  value={businessSettings.phone}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, phone: e.target.value })}
                  placeholder="+20 1XX XXX XXXX"
                  dir="ltr"
                />
              </div>
              <div>
                <Label htmlFor="settings-email">البريد الإلكتروني</Label>
                <Input
                  type="email"
                  id="settings-email"
                  value={businessSettings.email}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, email: e.target.value })}
                  placeholder="info@elnour.com"
                  dir="ltr"
                />
              </div>
              <div>
                <Label htmlFor="settings-website">الموقع الإلكتروني</Label>
                <Input
                  id="settings-website"
                  value={businessSettings.website}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, website: e.target.value })}
                  placeholder="https://elnour.com"
                  dir="ltr"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الإعدادات المالية</CardTitle>
            <CardDescription>الرسوم، الضرائب، والحد الأدنى للشحن المجاني</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="settings-default-shipping-fee">رسوم الشحن الافتراضية</Label>
                <Input
                  type="number"
                  step="0.01"
                  id="settings-default-shipping-fee"
                  value={businessSettings.default_shipping_fee}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, default_shipping_fee: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="settings-free-shipping-threshold">الحد الأدنى للشحن المجاني</Label>
                <Input
                  type="number"
                  step="0.01"
                  id="settings-free-shipping-threshold"
                  value={businessSettings.free_shipping_threshold}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, free_shipping_threshold: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label htmlFor="settings-tax-rate">معدل الضريبة (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  id="settings-tax-rate"
                  value={businessSettings.tax_rate}
                  onChange={(e) => setBusinessSettings({ ...businessSettings, tax_rate: parseFloat(e.target.value) })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>مظهر الواجهة</CardTitle>
            <CardDescription>الألوان الأساسية للعلامة التجارية</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="settings-primary-color">اللون الأساسي</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    aria-label="اختيار اللون الأساسي"
                    value={businessSettings.primary_color}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, primary_color: e.target.value })}
                    className="h-10 w-10 rounded-lg border cursor-pointer"
                  />
                  <Input
                    id="settings-primary-color"
                    value={businessSettings.primary_color}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, primary_color: e.target.value })}
                    dir="ltr"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="settings-secondary-color">اللون الثانوي</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    aria-label="اختيار اللون الثانوي"
                    value={businessSettings.secondary_color}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, secondary_color: e.target.value })}
                    className="h-10 w-10 rounded-lg border cursor-pointer"
                  />
                  <Input
                    id="settings-secondary-color"
                    value={businessSettings.secondary_color}
                    onChange={(e) => setBusinessSettings({ ...businessSettings, secondary_color: e.target.value })}
                    dir="ltr"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            حفظ الإعدادات
          </Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
