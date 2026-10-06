import type { ReactNode } from "react";
import Image from "next/image";

interface StatusScreenProps {
  eyebrow: string;
  title: string;
  description: ReactNode;
  footnote?: string;
  children?: ReactNode;
}

/** Full-page state (403/404/errors/waiting): keeps the Victory mark so people know where they are. */
export function StatusScreen({ eyebrow, title, description, footnote, children }: StatusScreenProps) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="max-w-lg text-center">
        <Image src="/brand/victory-mark.png" alt="Victory" width={44} height={44} className="mx-auto size-11" />
        <p className="eyebrow mt-8 text-muted">{eyebrow}</p>
        <h1 className="headline mt-3 text-4xl">{title}</h1>
        <div className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">{description}</div>
        {children && <div className="mt-8 flex flex-wrap justify-center gap-3">{children}</div>}
        {footnote && <p className="mt-8 text-xs text-subtle">{footnote}</p>}
      </div>
    </main>
  );
}
