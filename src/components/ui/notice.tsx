import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "error";

const tones: Record<Tone, { className: string; Icon: typeof Info }> = {
  info: { className: "border-brand/15 bg-brand-tint/70 text-brand-deep", Icon: Info },
  success: { className: "border-approved/20 bg-approved-bg text-approved", Icon: CheckCircle2 },
  warning: { className: "border-pending/20 bg-pending-bg text-pending", Icon: AlertTriangle },
  error: { className: "border-denied/20 bg-denied-bg text-denied", Icon: XCircle },
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { className: toneClass, Icon } = tones[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border px-3.5 py-3 text-sm", toneClass, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-extrabold">{title}</p>}
        {children && <div className="leading-relaxed [&_a]:font-bold [&_a]:underline">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
