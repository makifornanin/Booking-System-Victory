import Image from "next/image";
import Link from "next/link";

/** Official Victory circle-V mark beside the product name (no recreated wordmark). */
export function BrandMark({ href, label, sublabel }: { href: string; label: string; sublabel?: string }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5 rounded-sm" aria-label={`${label}${sublabel ? `, ${sublabel}` : ""} home`}>
      <Image src="/brand/victory-mark.png" alt="" width={32} height={32} loading="eager" className="size-8" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-extrabold tracking-tight text-ink">{label}</span>
        {sublabel && <span className="eyebrow mt-1 text-[9.5px] text-muted">{sublabel}</span>}
      </span>
    </Link>
  );
}
