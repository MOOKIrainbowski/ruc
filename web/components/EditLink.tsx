"use client";

import Link from "next/link";
import { useMe } from "./useMe";

/** 관리자에게만 보이는 "편집" 링크 (페이지 제목 아래 줄). */
export default function EditLink({ slug }: { slug: string }) {
  const me = useMe();
  if (!me?.admin) return null;
  return (
    <>
      {" · "}
      <Link href={`/admin/${slug}`} className="text-ruc-400 underline-offset-2 hover:underline">
        편집
      </Link>
    </>
  );
}
