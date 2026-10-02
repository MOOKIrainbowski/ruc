/**
 * 상단 내비 아이콘 (2026-10-03). 글자 대신 아이콘 — 이름은 툴팁과 aria-label 로 둡니다.
 * 의존성 없이 인라인 SVG 로 그립니다 (24 격자, 선 아이콘).
 */
export type NavIconName = "home" | "rules" | "wiki" | "charge" | "status" | "discord";

const PATHS: Record<NavIconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  rules: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.9 7.5 9.5 4.3-1.6 7.5-4.9 7.5-9.5V6z" />
      <path d="m9 12 2 2 4-4.5" />
    </>
  ),
  wiki: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" />
    </>
  ),
  charge: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10.5h18M7 15h4" />
    </>
  ),
  status: <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />,
  discord: (
    <>
      <path d="M8 7.5c2.6-.9 5.4-.9 8 0 1.6 2.4 2.4 4.9 2.4 7.6-1.4 1.1-3 1.8-4.6 2.2l-.9-1.6M8 7.5C6.4 9.9 5.6 12.4 5.6 15.1c1.4 1.1 3 1.8 4.6 2.2l.9-1.6" />
      <path d="M8.3 15.4c2.4 1 5 1 7.4 0" />
      <circle cx="9.8" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
};

export default function NavIcon({ name, className = "h-[18px] w-[18px]" }: { name: NavIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
