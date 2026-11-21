"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Sparkles, Plus, Mic, Copy, X } from "lucide-react"
import { useLanguage } from "@/lib/i18n/language"

/**
 * The floating AI pill.
 *
 * In the reference the assistant is not a page you go to — it is a persistent
 * object that sits at the bottom of every screen. That is the difference
 * between "a chatbot page" and "an AI-native product", so El Nour gets the
 * same affordance: a compact pill that expands into a composer.
 */
export function AiLauncher() {
  const pathname = usePathname()
  const { t } = useLanguage()
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("")

  // The agent page IS the chat — two chat surfaces at once would be noise.
  if (pathname === "/agent") return null

  return (
    /* Corner-anchored, and desktop-only. A centred pill floats over the middle
       of whatever the owner is reading — on the products table it landed
       straight across two rows. Anchored to the inline end it is still one
       click away, but it no longer hides data. On the phone the bottom dock
       owns that edge, and the dock's "More" sheet carries the assistant. */
    <div className="pointer-events-none fixed bottom-4 end-4 z-40 hidden lg:block">
      {open ? (
        <div className="pointer-events-auto w-[min(672px,calc(100vw-6rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-muted text-primary">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="text-[12.5px] font-semibold">{t("ai.launcher")}</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("ai.close")}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!value.trim()) return
              window.location.href = `/agent?q=${encodeURIComponent(value.trim())}`
            }}
            className="flex items-end gap-2 p-3"
          >
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={2}
              placeholder={t("ai.placeholder")}
              className="input min-h-[60px] resize-none"
              aria-label={t("ai.question")}
            />
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={t("ai.attach")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={t("ai.voice")}>
                <Mic className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="submit" className="btn-primary h-8 px-3">
                {t("ai.send")}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "pointer-events-auto inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-2.5",
            "shadow-lg transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong"
          )}
          aria-label={t("ai.launcher")}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-muted text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="text-[12.5px] font-medium">{t("ai.launcher")}</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>
      )}
    </div>
  )
}
