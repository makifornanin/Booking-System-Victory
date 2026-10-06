import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-sunken", className)} aria-hidden />;
}

/** Generic page placeholder used by route loading states. */
export function PageSkeleton({ variant = "editorial" }: { variant?: "editorial" | "operational" }) {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className={variant === "editorial" ? "h-11 w-80 max-w-full" : "h-7 w-56"} />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="divide-y divide-line border-y border-line">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 py-4">
            <Skeleton className="size-11 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
