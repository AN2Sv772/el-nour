"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface CopyButtonProps {
  value: string
  label?: string
  size?: "sm" | "lg" | "default"
  variant?: "default" | "outline" | "ghost"
  showLabel?: boolean
  successMessage?: string
  onCopy?: () => void
  disabled?: boolean
  "aria-label"?: string
}

export function CopyButton({
  value,
  label = "نسخ",
  size = "sm",
  variant = "ghost",
  showLabel = false,
  successMessage = "تم النسخ إلى الحافظة",
  onCopy,
  disabled = false,
  "aria-label": ariaLabel = "نسخ إلى الحافظة",
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const { toast } = useToast()

  const handleCopy = async () => {
    if (!value || disabled) return

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast({
        title: "تم النسخ",
        description: successMessage,
        variant: "default",
      })
      onCopy?.()
      
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast({
        title: "فشل النسخ",
        description: "تعذر النسخ إلى الحافظة",
        variant: "destructive",
      })
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCopy}
      disabled={disabled || !value}
      aria-label={ariaLabel}
      className={cn("gap-1", copied && "text-green-600")}
    >
      {copied ? (
        <Check className="h-4 w-4" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      {showLabel && <span>{label}</span>}
    </Button>
  )
}

interface CopyableFieldProps {
  value: string
  label?: string
  placeholder?: string
  showCopyButton?: boolean
  copyButtonLabel?: string
  readOnly?: boolean
  className?: string
  onCopy?: () => void
}

export function CopyableField({
  value,
  label,
  placeholder,
  showCopyButton = true,
  copyButtonLabel = "Copy",
  readOnly = true,
  className,
  onCopy,
}: CopyableFieldProps) {
  const [copied, setCopied] = React.useState(false)
  const { toast } = useToast()

  const handleCopy = async () => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast({
        title: "تم النسخ",
        description: `${label || "القيمة"} تم نسخها إلى الحافظة`,
        variant: "default",
      })
      onCopy?.()
      
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast({
        title: "فشل النسخ",
        description: "تعذر النسخ إلى الحافظة",
        variant: "destructive",
      })
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && (
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          {label}
        </label>
      )}
      <div className="flex-1 flex items-center gap-2">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          className={cn(
            "flex-1 px-3 py-2 text-sm bg-background border border-input rounded-md",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            readOnly && "bg-muted"
          )}
        />
        {showCopyButton && value && (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value)
                setCopied(true)
                toast({
                  title: "تم النسخ",
                  description: `${label || "القيمة"} تم نسخها إلى الحافظة`,
                  variant: "default",
                })
                onCopy?.()
                
                setTimeout(() => setCopied(false), 2000)
              } catch (error) {
                toast({
                  title: "فشل النسخ",
                  description: "تعذر النسخ إلى الحافظة",
                  variant: "destructive",
                })
              }
            }}
            className={cn(
              "p-2 rounded-md border border-input bg-background hover:bg-accent",
              "transition-colors",
              copied && "text-green-600 border-green-600"
            )}
            aria-label={`نسخ ${label || "القيمة"}`}
          >
            {copied ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2h-2M8 7h8v8H8V7z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
