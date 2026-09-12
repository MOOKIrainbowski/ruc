import { NextResponse } from "next/server";
import { getNetworkStatus } from "@/lib/servers";

export const revalidate = 30;

export async function GET() {
  const payload = await getNetworkStatus();
  return NextResponse.json(payload, {
    headers: {
      // 브라우저 30초, CDN은 30초 + 그동안 stale 허용
      "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
