import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ username: string }> }) {
  const { username } = await context.params;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,37}[a-zA-Z0-9]$/.test(username)) {
    return NextResponse.json({ error: { code: "USER_NOT_FOUND" } }, { status: 404 });
  }
  try {
    const headers = new Headers({ accept: "application/json" });
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const upstream = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/repositories/owner/${encodeURIComponent(username)}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    return new NextResponse(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "BACKEND_UNAVAILABLE" } }, { status: 503 });
  }
}
