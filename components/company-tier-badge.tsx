import { tierLabel, type Tier } from "@/lib/domain/company-tier";
import { cn } from "@/lib/utils";

export const TIER_STYLE: Record<Tier | "unrated", string> = {
  tier_1: "bg-warning/15 text-warning",
  tier_2: "bg-chart-2/15 text-chart-2",
  tier_3: "bg-muted text-muted-foreground",
  unrated: "border border-dashed text-muted-foreground",
};

/** Small pill showing how attractive a company is. Unrated companies show nothing unless `showUnrated`. */
export function CompanyTierBadge({ tier, showUnrated = false, className }: { tier: Tier | null; showUnrated?: boolean; className?: string }) {
  if (!tier && !showUnrated) return null;
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TIER_STYLE[tier ?? "unrated"], className)}>
      {tierLabel(tier)}
    </span>
  );
}
