import { cn } from "@/lib/utils"

export function Logo({
  size = 32,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-primary", className)}
    >
      <path
        d="M73.908 90.5796H3L65.6108 52.3152H96L73.908 90.5796Z"
        fill="currentColor"
      />
      <path
        d="M65.6108 10V44.8177L21.1724 63.4483L65.6108 10Z"
        fill="currentColor"
      />
    </svg>
  )
}
