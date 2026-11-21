"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { type LucideIcon } from "lucide-react"

/**
 * The page header — the reference's title block.
 *
 * An icon in a rounded square, the title, one line of context, and the
 * controls on the far side. The controls (the date range, the settings
 * button) belong to the page, so they are passed in as children rather than
 * hard-coded here.
 */
export function PageHeader({
  icon: Icon,
  leading,
  title,
  description,
  actions,
  className,
}: {
  icon?: LucideIcon
  /** A back link or any affordance that sits before the icon. */
  leading?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn("page-header", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {leading}
        {Icon && (
          /* Measured from the live reference: a 28px tile, 8px radius, the
             accent at 10% opacity, and the glyph in the accent itself. */
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="page-title truncate">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * The segmented control — the date range pills in the reference's header.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className={cn("segmented", className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn("segmented-item", active && "segmented-item-active")}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A section card — the reference's content block.
 *
 * A 1px border, a 12px radius, no shadow. The header row carries the title
 * on one side and the actions on the other.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  icon: Icon,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
  icon?: LucideIcon
}) {
  return (
    <section className={cn("card overflow-hidden", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-border-soft px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-foreground">
                {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  )
}

/**
 * The metric block — the reference's borderless KPI unit.
 *
 * A tiny caps label, the number, and a delta. Not a card: the reference
 * lets these sit directly on the canvas so the numbers read as a strip, not
 * as a grid of boxes.
 */
export function MetricBlock({
  label,
  value,
  delta,
  deltaLabel,
  hint,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  label: string
  value: React.ReactNode
  delta?: number | null
  deltaLabel?: string
  hint?: React.ReactNode
  icon?: LucideIcon
  tone?: "neutral" | "good" | "bad" | "warn"
  className?: string
}) {
  const deltaTone =
    delta === null || delta === undefined
      ? ""
      : delta > 0
        ? "text-success"
        : delta < 0
          ? "text-destructive"
          : "text-muted-foreground"

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5">
        {Icon && (
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-[5px]",
              tone === "good" && "bg-success-muted text-success",
              tone === "bad" && "bg-destructive-muted text-destructive",
              tone === "warn" && "bg-warning-muted text-warning",
              tone === "neutral" && "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="h-[10px] w-[10px]" aria-hidden="true" />
          </span>
        )}
        <span className="eyebrow truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[20px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
          {value}
        </span>
        {delta !== null && delta !== undefined && (
          <span className={cn("text-[11.5px] font-medium tabular-nums", deltaTone)}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {deltaLabel && <span className="text-[11.5px] text-muted-foreground">{deltaLabel}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * The warning block — the reference's amber insight panel.
 *
 * A tinted surface, a coloured left edge and a caps title. It is how the
 * product says "something here is not right" without shouting.
 */
export function InsightBlock({
  tone = "warn",
  title,
  children,
  action,
  className,
}: {
  tone?: "warn" | "bad" | "good" | "info"
  title?: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const tones = {
    warn: "bg-warning-muted border-warning/25 text-warning",
    bad: "bg-destructive-muted border-destructive/25 text-destructive",
    good: "bg-success-muted border-success/25 text-success",
    info: "bg-info-muted border-info/25 text-info",
  } as const

  return (
    <div
      className={cn(
        "rounded-xl border-s-2 px-3 py-2.5",
        tones[tone],
        className
      )}
    >
      {title && <p className="eyebrow mb-1 text-current">{title}</p>}
      <div className="text-[12px] leading-relaxed text-foreground/85">{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * The empty state — professional, specific, and never a shrug.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("empty-state", className)}>
      {Icon && (
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card-2 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
