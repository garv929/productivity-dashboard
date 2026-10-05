import { TIER_COLOR, tierLabel, type Tier } from "@/lib/domain/company-tier";
import { cn } from "@/lib/utils";

/** Tier colour at low opacity, for backgrounds. */
export const tierTint = (tier: Tier, pct = 16) => `color-mix(in oklab, ${TIER_COLOR[tier]} ${pct}%, transparent)`;

/** Small pill with the tier's colour dot and name. Unrated companies show nothing unless `showUnrated`. */
export function CompanyTierBadge({ tier, showUnrated = false, className }: { tier: Tier | null; showUnrated?: boolean; className?: string }) {
  if (!tier && !showUnrated) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        !tier && "border border-dashed text-muted-foreground",
        className,
      )}
      style={tier ? { backgroundColor: tierTint(tier) } : undefined}
    >
      {tier && <TierDot tier={tier} decorative />}
      {tierLabel(tier)}
    </span>
  );
}

/** Just the colour, for compact places like application cards; the tier name is in the tooltip. */
export function TierDot({ tier, decorative = false, className }: { tier: Tier; decorative?: boolean; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15", className)}
      style={{ backgroundColor: TIER_COLOR[tier] }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": tierLabel(tier), title: tierLabel(tier) })}
    />
  );
}

/** "● Tier 1 ● Tier 2 ● Tier 3" key, so colour-only markers can be read. */
export function TierLegend({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3 text-xs text-muted-foreground", className)}>
      {(["tier_1", "tier_2", "tier_3"] as const).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <TierDot tier={t} decorative />
          {tierLabel(t)}
        </span>
      ))}
    </span>
  );
}
