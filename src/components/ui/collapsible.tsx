"use client"

import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Trigger
    ref={ref}
    className={cn(
      "flex flex-col items-start justify-center text-sm font-medium py-2 transition-colors hover:underline [&[data-state=open]>svg]:rotate-180",
      className
    )}
    {...props}
  >
    {children}
    <ChevronDown className="ml-2 h-4 w-4 transition-transform duration-200 shrink-0" />
  </CollapsiblePrimitive.Trigger>
))
CollapsibleTrigger.displayName = CollapsiblePrimitive.Trigger.displayName

const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={cn("overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-up-2 data-[state=open]:slide-down-2", className)}
    {...props}
  >
    <div className="pt-2 pb-4">{children}</div>
  </CollapsiblePrimitive.Content>
))
CollapsibleContent.displayName = CollapsiblePrimitive.Content.displayName

export { Collapsible, CollapsibleTrigger, CollapsibleContent }