import Image from "next/image";
import Link from "next/link";
import { MC_ADDRESS, t, type Lang } from "@/lib/content";

export default function Footer({ lang }: { lang: Lang }) {
  const c = t(lang);
  const linkClass = "text-white/60 transition-colors hover:text-ruc-400";
  return (
    <footer className="mt-10 border-t border-white/8">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <Image src="/icon.png" alt="" width={24} height={24} className="h-6 w-6" />
            <span className="text-[12px] font-semibold text-white/85">{c.footer.madeWith}</span>
          </div>
          <p className="text-[11px] text-white/60">{c.footer.tagline}</p>
          <p className="text-[11px] text-white/60">
            {c.footer.address} <code className="inline-code">{MC_ADDRESS}</code>
          </p>
        </div>
        {c.footer.groups.map((g) => (
          <nav key={g.title} aria-label={g.title} className="space-y-2.5 text-[11px]">
            <h2 className="font-semibold text-white/85">{g.title}</h2>
            <ul className="space-y-2">
              {g.links.map((l) => (
                <li key={l.label}>
                  {l.href.startsWith("http") ? (
                    <a href={l.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className={linkClass}>
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto max-w-6xl space-y-1.5 border-t border-white/8 px-4 py-5 text-[10.5px] text-white/45 sm:px-6">
        <p>{c.footer.contact}</p>
        <p>{c.footer.disclaimer}</p>
        <p>© 2026 {c.footer.madeWith}</p>
      </div>
    </footer>
  );
}
