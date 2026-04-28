import { useEffect, useRef, useState } from "react";
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
  Infinity,
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

type BrandConfig =
  | { type: "lucide"; name: string }
  | { type: "image"; src: string }
  | { type: "none" };

const STORAGE_KEY = "forge.brand.icon";
const DEFAULT_BRAND: BrandConfig = { type: "lucide", name: "hammer" };

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
  infinity: Infinity,
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

function loadBrand(): BrandConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BRAND;
    return JSON.parse(raw) as BrandConfig;
  } catch {
    return DEFAULT_BRAND;
  }
}

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
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Persist + broadcast so other instances sync
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brand));
    window.dispatchEvent(
      new CustomEvent("forge:brand-changed", { detail: brand }),
    );
  }, [brand]);

  // Listen for changes from sibling instances
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<BrandConfig>).detail;
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
    setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => document.removeEventListener("mousedown", handler);
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
        onClick={() => configurable && setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center justify-center rounded-sm transition-colors",
          configurable && "hover:bg-[rgba(249,115,22,0.08)] cursor-pointer",
          !configurable && "cursor-default",
        )}
        style={{ padding: 4 }}
        title={configurable ? "Change brand icon" : undefined}
        aria-label="Change brand icon"
      >
        {renderIcon() ?? (
          <span
            className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            style={{ minWidth: size }}
          >
            ·
          </span>
        )}
      </button>

      {open && configurable && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-1 z-50 w-[260px] bg-[var(--color-elevated)] border border-[var(--color-border-strong)] rounded-md shadow-lg overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-fg-muted)] font-semibold">
              Brand icon
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="p-2">
            {/* Lucide grid */}
            <div className="grid grid-cols-8 gap-1 max-h-[160px] overflow-y-auto">
              {Object.entries(ICON_LIBRARY).map(([name, Icon]) => {
                const active =
                  brand.type === "lucide" && brand.name === name;
                return (
                  <button
                    key={name}
                    onClick={() => {
                      setBrand({ type: "lucide", name });
                      setOpen(false);
                    }}
                    className={cn(
                      "w-7 h-7 flex items-center justify-center rounded transition-colors",
                      active
                        ? "bg-[var(--color-accent)] text-white"
                        : "hover:bg-[rgba(249,115,22,0.10)] text-[var(--color-fg-muted)] hover:text-[var(--color-accent)]",
                    )}
                    title={name}
                  >
                    <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] p-2 space-y-1">
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] hover:bg-[rgba(249,115,22,0.06)]"
            >
              <Upload className="w-3 h-3 text-[var(--color-accent)]" />
              <span>Upload image…</span>
              {brand.type === "image" && (
                <span className="ml-auto text-[var(--color-accent)] text-[10px] uppercase tracking-[0.1em]">
                  current
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setBrand({ type: "none" });
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] hover:bg-[rgba(249,115,22,0.06)]",
                brand.type === "none" && "text-[var(--color-accent)]",
              )}
            >
              <span className="w-3 h-3 inline-block border border-current rounded-sm" />
              <span>None</span>
              {brand.type === "none" && (
                <span className="ml-auto text-[10px] uppercase tracking-[0.1em]">
                  current
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setBrand(DEFAULT_BRAND);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] hover:bg-[rgba(249,115,22,0.06)] text-[var(--color-fg-muted)]"
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
        </div>
      )}
    </span>
  );
}
