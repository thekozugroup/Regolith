import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Hammer,
  Activity,
  Zap,
  Cpu,
  Box,
  Layers,
  Boxes,
  Anchor,
  Atom,
  Compass,
  Cog,
  Crown,
  Diamond,
  Drama,
  Feather,
  Flag,
  Flame,
  Gem,
  Globe,
  Heart,
  Infinity as InfinityIcon,
  Leaf,
  Mountain,
  Orbit,
  Pyramid,
  Rocket,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Triangle,
  Upload,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_BRAND,
  isBrandConfig,
  loadBrand,
  saveBrand,
  type BrandConfig,
} from "@/lib/brand";
import { getModalFocusableElements } from "@/lib/modal";

// Curated Lucide subset — recognizable, geometric, work well at 18px.
const ICON_LIBRARY: Record<string, LucideIcon> = {
  hammer: Hammer,
  activity: Activity,
  zap: Zap,
  cpu: Cpu,
  box: Box,
  layers: Layers,
  boxes: Boxes,
  anchor: Anchor,
  atom: Atom,
  compass: Compass,
  cog: Cog,
  crown: Crown,
  diamond: Diamond,
  drama: Drama,
  feather: Feather,
  flag: Flag,
  flame: Flame,
  gem: Gem,
  globe: Globe,
  heart: Heart,
  infinity: InfinityIcon,
  leaf: Leaf,
  mountain: Mountain,
  orbit: Orbit,
  pyramid: Pyramid,
  rocket: Rocket,
  snowflake: Snowflake,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  triangle: Triangle,
};

interface Props {
  className?: string;
  size?: number;
  /** Whether clicking opens the picker. Defaults to true. */
  configurable?: boolean;
}

const POPOVER_INSET = 8;
const POPOVER_GAP = 4;
const POPOVER_WIDTH = 280;
const POPOVER_PREFERRED_HEIGHT = 460;

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

function getVisibleFocusableElements(container: HTMLElement): HTMLElement[] {
  return getModalFocusableElements(container).filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      element.getClientRects().length > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  });
}

export function BrandLogo({
  className,
  size = 18,
  configurable = true,
}: Props) {
  const [brand, setBrand] = useState<BrandConfig>(loadBrand);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const didFocusPickerRef = useRef(false);
  const pickerId = useId();

  const closePicker = useCallback((restoreFocus = false) => {
    didFocusPickerRef.current = false;
    setOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Persist + broadcast so other instances sync
  useEffect(() => {
    saveBrand(brand);
    window.dispatchEvent(
      new CustomEvent("forge:brand-changed", { detail: brand }),
    );
  }, [brand]);

  // Listen for changes from sibling instances
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<BrandConfig>).detail;
      // The event carries a payload from anywhere on the page, so it gets the
      // same guard the stored value gets — a malformed detail must not become
      // render state for a component the whole shell depends on.
      if (!isBrandConfig(next)) return;
      if (JSON.stringify(next) !== JSON.stringify(brand)) {
        setBrand(next);
      }
    };
    window.addEventListener("forge:brand-changed", handler);
    return () => window.removeEventListener("forge:brand-changed", handler);
  }, [brand]);

  // A non-modal picker should stay anchored to its trigger without ever
  // covering the viewport's last reachable controls.
  useEffect(() => {
    if (!open) return;
    const updatePosition = (event?: Event) => {
      // The panel itself scrolls on short displays; its own scroll must not
      // make the fixed anchor recompute or trigger a state update.
      if (
        event?.type === "scroll" &&
        event.target instanceof Node &&
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        closePicker(false);
        return;
      }
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(POPOVER_WIDTH, viewportWidth - POPOVER_INSET * 2);
      const below = viewportHeight - rect.bottom - POPOVER_INSET - POPOVER_GAP;
      const above = rect.top - POPOVER_INSET - POPOVER_GAP;
      const placeAbove = below < POPOVER_PREFERRED_HEIGHT && above > below;
      const available = Math.max(0, placeAbove ? above : below);
      const maxHeight = Math.min(
        viewportHeight - POPOVER_INSET * 2,
        Math.max(available, 44),
      );
      const top = placeAbove
        ? Math.max(POPOVER_INSET, rect.top - POPOVER_GAP - maxHeight)
        : Math.min(
            Math.max(POPOVER_INSET, rect.bottom + POPOVER_GAP),
            viewportHeight - POPOVER_INSET - maxHeight,
          );

      const nextPosition = {
        left: Math.max(
          POPOVER_INSET,
          Math.min(rect.left, viewportWidth - POPOVER_INSET - width),
        ),
        top,
        width,
        maxHeight,
      };
      setPosition((current) =>
        current &&
        current.left === nextPosition.left &&
        current.top === nextPosition.top &&
        current.width === nextPosition.width &&
        current.maxHeight === nextPosition.maxHeight
          ? current
          : nextPosition,
      );
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [closePicker, open]);

  // Close on outside pointer without stealing the focus that pointer selected.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        closePicker(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker(true);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePicker, open]);

  // The portal is mounted only after a measured position exists. Focus once
  // per open cycle after that mount, rather than racing that second render.
  useEffect(() => {
    if (!open || !position || didFocusPickerRef.current) return;
    didFocusPickerRef.current = true;
    const selected = popoverRef.current?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    const first = popoverRef.current?.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    );
    (selected ?? first)?.focus();
  }, [open, position]);

  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setBrand({ type: "image", src: String(reader.result) });
      closePicker(true);
    };
    reader.readAsDataURL(file);
  };

  const renderIcon = () => {
    if (brand.type === "image") {
      return (
        <img
          src={brand.src}
          alt="Forge"
          className="object-contain"
          style={{ width: size, height: size }}
        />
      );
    }
    if (brand.type === "none") {
      return null;
    }
    const Icon = ICON_LIBRARY[brand.name] ?? Hammer;
    return (
      <Icon
        style={{ width: size, height: size }}
        className="text-[var(--color-accent)]"
        strokeWidth={2}
      />
    );
  };

  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          if (!configurable) return;
          if (open) {
            closePicker(false);
          } else {
            setPosition(null);
            setOpen(true);
          }
        }}
        className={cn(
          "press-flat inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner transition-colors",
          configurable && "hover:bg-[var(--color-accent-soft)] cursor-pointer",
          !configurable && "cursor-default",
        )}
        title={configurable ? "Change brand icon" : undefined}
        aria-label={configurable ? "Change brand icon" : "Brand icon"}
        aria-expanded={configurable ? open : undefined}
        aria-controls={configurable ? pickerId : undefined}
        aria-haspopup={configurable ? "dialog" : undefined}
        disabled={!configurable}
      >
        {renderIcon() ?? (
          <span
            className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            style={{ minWidth: size }}
          >
            ·
          </span>
        )}
      </button>

      {open && configurable && position && createPortal(
        <div
          ref={popoverRef}
          id={pickerId}
          role="dialog"
          aria-label="Choose brand icon"
          // Derived-radius rule: this compact popover pads with p-2 (8px),
          // not the modal's default --modal-pad (16px). Overriding the pad
          // token HERE makes .modal-panel derive BOTH sides from the pad
          // the markup actually uses: outer = 8px + control = 12px, and
          // --radius-inner = control (4px) for the corner children.
          className="modal-panel [--modal-pad:0.5rem] fixed z-[100] bg-[var(--color-elevated)] border border-[var(--color-border-strong)] shadow-2xl overflow-y-auto"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
          onBlur={(event) => {
            // A native file chooser can report null relatedTarget while the
            // hidden input remains responsible for its eventual change event.
            if (
              event.relatedTarget &&
              !event.currentTarget.contains(event.relatedTarget as Node)
            ) {
              closePicker(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const panel = event.currentTarget;
            const items = getVisibleFocusableElements(panel);
            const currentIndex = items.indexOf(document.activeElement as HTMLElement);
            const isFirst = currentIndex === 0;
            const isLast = currentIndex === items.length - 1;

            if (event.shiftKey && isFirst) {
              event.preventDefault();
              closePicker(true);
              return;
            }
            if (!event.shiftKey && isLast) {
              event.preventDefault();
              const trigger = triggerRef.current;
              const documentItems = getVisibleFocusableElements(document.body)
                .filter((element) => !panel.contains(element));
              const triggerIndex = trigger ? documentItems.indexOf(trigger) : -1;
              const next = triggerIndex >= 0
                ? documentItems[triggerIndex + 1]
                : null;
              closePicker(false);
              (next ?? trigger)?.focus();
            }
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] uppercase tracking-[0.15em] text-[var(--color-fg-muted)] font-semibold">
              Brand icon
            </span>
            <button
              type="button"
              onClick={() => closePicker(true)}
              aria-label="Close brand icon picker"
              className="press-flat inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-2">
            {/* Lucide grid */}
            <div className="grid max-h-[220px] grid-cols-5 gap-1 overflow-y-auto">
              {Object.entries(ICON_LIBRARY).map(([name, Icon]) => {
                const active =
                  brand.type === "lucide" && brand.name === name;
                return (
                  <button
                    type="button"
                    key={name}
                    onClick={() => {
                      setBrand({ type: "lucide", name });
                      closePicker(true);
                    }}
                    className={cn(
                      "press-flat flex min-h-11 min-w-11 items-center justify-center rounded-inner transition-colors",
                      active
                        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "hover:bg-[var(--color-accent-soft)] text-[var(--color-fg-muted)] hover:text-[var(--color-accent)]",
                    )}
                    aria-label={`${name} brand icon`}
                    aria-pressed={active}
                  >
                    <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] p-2 space-y-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="press-flat flex min-h-11 w-full items-center gap-2 rounded-inner p-2 text-[12px] hover:bg-[var(--color-accent-faint)]"
            >
              <Upload className="w-3 h-3 text-[var(--color-accent)]" />
              <span>Upload image…</span>
              {brand.type === "image" && (
                <span className="ml-auto text-[var(--color-accent)] text-[11px] uppercase tracking-[0.1em]">
                  current
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setBrand({ type: "none" });
                closePicker(true);
              }}
              className={cn(
                "press-flat flex min-h-11 w-full items-center gap-2 rounded-inner p-2 text-[12px] hover:bg-[var(--color-accent-faint)]",
                brand.type === "none" && "text-[var(--color-accent)]",
              )}
            >
              <span className="w-3 h-3 inline-block border border-current rounded-inner" />
              <span>None</span>
              {brand.type === "none" && (
                <span className="ml-auto text-[11px] uppercase tracking-[0.1em]">
                  current
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setBrand(DEFAULT_BRAND);
                closePicker(true);
              }}
              className="press-flat flex min-h-11 w-full items-center gap-2 rounded-inner p-2 text-[12px] text-[var(--color-fg-muted)] hover:bg-[var(--color-accent-faint)]"
            >
              <span>Reset to default</span>
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Permit choosing the same local mark again after a cancelled
              // or failed attempt; FileReader owns the captured File value.
              e.currentTarget.value = "";
              if (f) handleUpload(f);
            }}
          />
        </div>,
        document.body,
      )}
    </span>
  );
}
