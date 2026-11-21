"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * The reference's button language: small, quiet, and border-first.
 *
 * The old buttons were 44px tall with a coloured shadow — the product's own
 * screens were reading as a marketing site rather than an instrument. The
 * reference's buttons are 32-36px, flat, and rely on the border or the fill
 * alone.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary-fill text-white hover:bg-primary-hover active:bg-primary-hover/90",
        destructive: "bg-destructive-fill text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-card text-foreground hover:bg-muted hover:border-border-strong",
        secondary: "bg-muted text-secondary-foreground hover:bg-muted-2",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success text-white hover:bg-success/90",
        warning: "bg-warning text-white hover:bg-warning/90",
      },
      size: {
        default: "h-9 px-3.5 py-1.5",
        sm: "h-8 rounded-lg px-2.5 text-[12px]",
        lg: "h-10 rounded-lg px-4 text-[13.5px]",
        xl: "h-11 rounded-lg px-5 text-sm",
        icon: "h-9 w-9 p-0",
        "icon-sm": "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="mr-2 h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            جاري التحميل...
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }