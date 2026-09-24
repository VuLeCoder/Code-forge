import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await context.params;
  const validOwner = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,37}[a-zA-Z0-9]$/.test(owner);
  const validRepo = repo.length <= 100 && /^(?!.*\.\.)(?!.*\.git$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(repo);
  if (!validOwner || !validRepo) return NextResponse.json({ error: { code: "REPOSITORY_NOT_FOUND" } }, { status: 404 });
  const headers = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  try {
    const upstream = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    return new NextResponse(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "BACKEND_UNAVAILABLE" } }, { status: 503 });
  }
}
