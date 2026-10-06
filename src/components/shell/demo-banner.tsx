import { getDataMode } from "@/lib/env";

export function DemoBanner() {
  if (getDataMode() !== "demo") return null;
  return (
    <div className="bg-ink px-4 py-1.5 text-center text-xs font-semibold text-white/80">
      Development demo — sample data in memory, reset when the dev server restarts. Never available in production.
    </div>
  );
}
