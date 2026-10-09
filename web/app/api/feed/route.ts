import { NextResponse } from "next/server";
import { getRaidFeed } from "@/lib/feed";

export const revalidate = 60;

export async function GET() {
  const feed = await getRaidFeed();
  return NextResponse.json(feed, {
    headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
