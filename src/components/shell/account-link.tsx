import Link from "next/link";
import { cn, initials } from "@/lib/utils";

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "size-7 text-[11px]", md: "size-8 text-xs", lg: "size-14 text-lg" };
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-brand-deep font-extrabold text-white", sizes[size], className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function AccountLink({ fullName, compact }: { fullName: string; compact?: boolean }) {
  return (
    <Link href="/account" className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 text-sm font-bold text-ink transition-colors hover:bg-sunken sm:pr-3" aria-label="Your account">
      <Avatar name={fullName} />
      {!compact && <span className="hidden max-w-40 truncate sm:inline">{fullName}</span>}
    </Link>
  );
}
