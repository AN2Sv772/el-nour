"use client"

import * as React from "react"
import { Drawer } from "vaul"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

const Sheet = Drawer.Root
const SheetTrigger = Drawer.Trigger
const SheetClose = Drawer.Close
const SheetContent = Drawer.Content
const SheetPortal = Drawer.Portal
const SheetOverlay = Drawer.Overlay
const SheetHandle = Drawer.Handle
const SheetTitle = Drawer.Title
const SheetDescription = Drawer.Description

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetPortal,
  SheetOverlay,
  SheetHandle,
  SheetTitle,
  SheetDescription,
}