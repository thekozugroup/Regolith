import { useEffect, useRef, useState } from "react";
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

export function BrandLogo({
  className,
  size = 18,
  configurable = true,
}: Props) {
  const [brand, setBrand] = useState<BrandConfig>(loadBrand);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    setTimeout(() => document.addEventListener("mousedown", handler), 0);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setBrand({ type: "image", src: String(reader.result) });
      setOpen(false);
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
          if (!open && triggerRef.current) {
            const r = triggerRef.current.getBoundingClientRect();
            setAnchor({ x: r.left, y: r.bottom + 4 });
          }
          setOpen((o) => !o);
        }}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner transition-colors",
          configurable && "hover:bg-[var(--color-accent-soft)] cursor-pointer",
          !configurable && "cursor-default",
        )}
        title={configurable ? "Change brand icon" : undefined}
        aria-label={configurable ? "Change brand icon" : "Brand icon"}
        aria-expanded={configurable ? open : undefined}
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

      {open && configurable && anchor && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Choose brand icon"
          // Derived-radius rule: this compact popover pads with p-2 (8px),
          // not the modal's default --modal-pad (16px). Overriding the pad
          // token HERE makes .modal-panel's cascade re-derive the inner
          // radius from the pad the markup actually uses: --radius-inner =
          // max(0, --radius-modal − 8px) = 12px, concentric with the 20px
          // outer corner instead of assuming a 16px pad that isn't there.
          // (--radius-modal itself resolves at :root and stays 20px.)
          className="modal-panel [--modal-pad:0.5rem] fixed z-[100] w-[280px] bg-[var(--color-elevated)] border border-[var(--color-border-strong)] shadow-2xl overflow-hidden"
          style={{
            left: Math.min(anchor.x, window.innerWidth - 290),
            top: anchor.y,
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] uppercase tracking-[0.15em] text-[var(--color-fg-muted)] font-semibold">
              Brand icon
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close brand icon picker"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
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
                      setOpen(false);
                    }}
                    className={cn(
                      "flex min-h-11 min-w-11 items-center justify-center rounded-inner transition-colors",
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
              className="flex min-h-11 w-full items-center gap-2 rounded-inner px-2 text-[12px] hover:bg-[var(--color-accent-faint)]"
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
                setOpen(false);
              }}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-inner px-2 text-[12px] hover:bg-[var(--color-accent-faint)]",
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
                setOpen(false);
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-inner px-2 text-[12px] text-[var(--color-fg-muted)] hover:bg-[var(--color-accent-faint)]"
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
              if (f) handleUpload(f);
            }}
          />
        </div>,
        document.body,
      )}
    </span>
  );
}
