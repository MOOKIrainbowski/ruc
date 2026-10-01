import Image from "next/image";
import Link from "next/link";
import { t, type Lang } from "@/lib/content";

export default function Footer({ lang }: { lang: Lang }) {
  const c = t(lang);
  const linkClass = "text-white/60 transition-colors hover:text-ruc-400";
  return (
    <footer className="mt-10 border-t border-white/8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Image src="/icon.png" alt="" width={24} height={24} className="h-6 w-6" />
          <span className="text-[11px] text-white/60">{c.footer.tagline}</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
          {c.footer.links.map((l) =>
            l.href.startsWith("http") ? (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className={linkClass}>
                {l.label}
              </Link>
            ),
          )}
          <span className="text-white/40">© 2026 {c.footer.madeWith}</span>
        </nav>
      </div>
    </footer>
  );
}
