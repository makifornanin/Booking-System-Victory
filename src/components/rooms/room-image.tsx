import Image from "next/image";
import { cn } from "@/lib/utils";

export function roomShortName(name: string): string {
  return name.replace(/^room\s+/i, "") || name;
}

/** Room photo, or an intentional typographic placeholder until a real photo is uploaded. */
export function RoomImage({ name, url, sizes, className, eager }: { name: string; url: string | null; sizes: string; className?: string; eager?: boolean }) {
  return (
    <div className={cn("relative overflow-hidden bg-sunken", className)}>
      {url ? (
        <Image src={url} alt={`${name} photo`} fill sizes={sizes} loading={eager ? "eager" : "lazy"} unoptimized={!url.startsWith("https://")} className="object-cover" />
      ) : (
        <div className="flex h-full flex-col justify-between p-5" role="img" aria-label={`${name}, photo coming soon`}>
          <span className="eyebrow text-[10px] text-subtle">Victory</span>
          <span className="headline self-end text-[5.5rem] leading-none text-line-strong">{roomShortName(name).replace(/^Event's Place - /, "")}</span>
        </div>
      )}
    </div>
  );
}
