import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** ShiftUp eki: durum tonu — outline rozet + renkli nokta (DESIGN_GUIDE §5 "Durum rozeti") */
export type BadgeTone = "success" | "warning" | "info" | "danger" | "plum" | "brand" | "neutral"

const TONE_DOT: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-destructive",
  plum: "bg-plum",
  brand: "bg-primary",
  neutral: "bg-muted-foreground/60",
}

function Badge({
  className,
  variant = "default",
  tone,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; tone?: BadgeTone }) {
  const Comp = asChild ? Slot.Root : "span"
  const v = tone ? "outline" : variant

  return (
    <Comp
      data-slot="badge"
      data-variant={v}
      className={cn(badgeVariants({ variant: v }), tone && "gap-1.5", className)}
      {...props}
    >
      {tone && !asChild && (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      )}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
