'use client'

import { useEffect, useState } from 'react'
import { animate } from 'framer-motion'

interface AnimatedNumberProps {
  value: number
  decimals?: number
  duration?: number
  className?: string
}

export function AnimatedNumber({ 
  value, 
  decimals = 0, 
  duration = 1.2, 
  className = '' 
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const controls = animate(display, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v)
    })
    return () => controls.stop()
  }, [value, duration])

  return (
    <span className={className}>
      {display.toLocaleString(undefined, { 
        minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals 
      })}
    </span>
  )
}