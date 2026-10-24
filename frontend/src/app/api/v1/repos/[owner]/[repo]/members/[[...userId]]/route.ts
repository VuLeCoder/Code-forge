import { NextRequest, NextResponse } from "next/server";

const validOwner = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,37}[a-zA-Z0-9]$/.test(value);
const validRepo = (value: string) => value.length <= 100 && /^(?!.*\.\.)(?!.*\.git$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(value);
const validUuid = (value: string) => /^[a-f0-9-]{36}$/i.test(value);

type Context = { params: Promise<{ owner: string; repo: string; userId?: string[] }> };

async function proxy(request: NextRequest, context: Context) {
  const { owner, repo, userId = [] } = await context.params;
  const headers = { "content-type": "application/json", "cache-control": "private, no-store" };

  if (!validOwner(owner) || !validRepo(repo)) {
    return NextResponse.json({ error: { message: "Không tìm thấy repository." } }, { status: 404, headers });
  }

  const isList = userId.length === 0 && request.method === "GET";
  const isMemberOp = userId.length === 1 && validUuid(userId[0]) && ["PATCH", "DELETE"].includes(request.method);

  if (!isList && !isMemberOp) {
    return NextResponse.json({ error: { message: "Không tìm thấy endpoint." } }, { status: 404, headers });
  }

  const origin = (process.env.APP_ORIGIN ?? request.nextUrl.origin).replace(/\/$/, "");
  if (request.method !== "GET" && request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: { message: "Nguồn gửi yêu cầu không được phép." } }, { status: 403, headers });
  }

  try {
    const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "");
    const subpath = userId.length ? `/${userId[0]}` : "";
    const upstream = await fetch(`${backendUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/members${subpath}`, {
      method: request.method,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        origin,
        ...(request.method === "PATCH" ? { "content-type": "application/json" } : {}),
      },
      ...(request.method === "PATCH" ? { body: await request.text() } : {}),
    });
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: { message: "Máy chủ tạm thời không thể kết nối. Vui lòng thử lại." } }, { status: 503, headers });
  }
}

export const GET = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
