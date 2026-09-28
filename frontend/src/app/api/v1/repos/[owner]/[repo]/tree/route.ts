import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await context.params;
  const headers = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const responseHeaders = { "content-type": "application/json", "cache-control": "private, no-store" };
  try {
    const url = new URL(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree`);
    for (const name of ["ref", "path"]) {
      for (const value of request.nextUrl.searchParams.getAll(name)) url.searchParams.append(name, value);
    }
    const upstream = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(35_000) });
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: { code: "BACKEND_UNAVAILABLE" } }, { status: 503, headers: responseHeaders });
  }
}
