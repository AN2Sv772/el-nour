"use client"

import dynamic from "next/dynamic"
import type { MobileSidebarSheetProps } from "./mobile-sidebar-sheet"

// Dynamically import vaul Sheet with SSR disabled
const MobileSidebarSheet = dynamic<MobileSidebarSheetProps>(
  () => import("./mobile-sidebar-sheet"),
  { ssr: false }
)

export function MobileSidebar(props: MobileSidebarSheetProps) {
  return <MobileSidebarSheet {...props} />
}
