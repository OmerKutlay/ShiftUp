"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

// SelectContent'teki arama kutusunun sorgusu; SelectItem eşleşmeyince gizlenir.
const SelectSearchContext = React.createContext("")

// Türkçe karakterleri sadeleştirir: "çalışan" ile "calisan" aynı eşleşir.
function normalizeSearch(text: string) {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
}

function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join(" ")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return nodeText(node.props.children)
  }
  return ""
}

const ITEM_SELECTOR = "[data-slot=select-item]:not([hidden])"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  searchable = true,
  searchPlaceholder = "Ara...",
  onCloseAutoFocus,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  searchable?: boolean
  searchPlaceholder?: string
}) {
  const [query, setQuery] = React.useState("")
  const [noResults, setNoResults] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  // Radix açılışta seçili öğeye odaklanır; kullanıcı fareyle/klavyeyle
  // listede dolaşmaya başlayana kadar odağı arama kutusunda tutarız.
  const interactedRef = React.useRef(false)
  const normalizedQuery = searchable ? normalizeSearch(query) : ""

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!searchable || !viewport) return
    setNoResults(normalizedQuery !== "" && !viewport.querySelector(ITEM_SELECTOR))
  }, [searchable, normalizedQuery, children])

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // Liste değişince başa dön; Radix kaydırma oklarını scroll olayıyla günceller.
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event("scroll"))
  }, [normalizedQuery])

  const focusInput = () => inputRef.current?.focus({ preventScroll: true })

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Ok tuşları Radix'e gider (listeye geçiş); diğer tuşlar yazmaya aittir,
    // Radix'in harfle-atlama (typeahead) davranışına ulaşmamalı.
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      interactedRef.current = true
      return
    }
    if (event.key === "Escape" || event.key === "Tab") return
    event.stopPropagation()
    if (event.key === "Enter") {
      // Enter: görünen ilk seçeneği seç.
      event.preventDefault()
      viewportRef.current
        ?.querySelector<HTMLElement>(`${ITEM_SELECTOR}:not([data-disabled])`)
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    }
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          searchable &&
            "max-h-[min(20rem,var(--radix-select-content-available-height))] overflow-y-hidden",
          className
        )}
        position={position}
        align={align}
        onCloseAutoFocus={(event) => {
          setQuery("")
          interactedRef.current = false
          onCloseAutoFocus?.(event)
        }}
        {...props}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (!searchable || event.defaultPrevented || event.target === inputRef.current) return
          // Odak listedeyken basılan harfler Radix'in typeahead'i yerine aramaya yazılır.
          const isModifier = event.ctrlKey || event.altKey || event.metaKey
          if (isModifier || event.key === " ") return
          if (event.key.length === 1) {
            event.preventDefault()
            setQuery((q) => q + event.key)
          } else if (event.key === "Backspace") {
            event.preventDefault()
            setQuery((q) => q.slice(0, -1))
          } else {
            return
          }
          interactedRef.current = false
          focusInput()
        }}
      >
        {searchable && (
          <div
            data-slot="select-search"
            className="flex shrink-0 items-center gap-2 border-b px-2"
          >
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            />
          </div>
        )}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          ref={viewportRef}
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
          onPointerMove={searchable ? () => { interactedRef.current = true } : undefined}
          onFocusCapture={
            searchable
              ? () => {
                  // Açılıştaki otomatik odak: masaüstünde arama kutusuna taşınır.
                  // Dokunmatikte klavye kendiliğinden açılmasın diye öğede kalır.
                  if (!interactedRef.current && window.matchMedia("(pointer: fine)").matches) {
                    focusInput()
                  }
                }
              : undefined
          }
        >
          <SelectSearchContext.Provider value={normalizedQuery}>
            {children}
          </SelectSearchContext.Provider>
          {noResults && (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              Sonuç bulunamadı
            </div>
          )}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  textValue,
  disabled,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const query = React.useContext(SelectSearchContext)
  // Eşleşmeyen öğe kaldırılmaz, gizlenir: seçili değerin metni tetikleyicide
  // görünmeye devam eder; disabled olması ok tuşlarıyla gezinmede atlanmasını sağlar.
  const hidden =
    query !== "" && !normalizeSearch(textValue ?? nodeText(children)).includes(query)
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      textValue={textValue}
      disabled={disabled || hidden}
      hidden={hidden}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
