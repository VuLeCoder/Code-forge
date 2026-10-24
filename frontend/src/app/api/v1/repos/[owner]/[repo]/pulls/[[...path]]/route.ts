import { NextRequest, NextResponse } from "next/server";
import { withBackendClientIp } from "@/lib/backend-client-ip";

type Context = { params: Promise<{ owner: string; repo: string; path?: string[] }> };

const validOwner = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,37}[a-zA-Z0-9]$/.test(value);
const validRepo = (value: string) => value.length <= 100 && /^(?!.*\.\.)(?!.*\.git$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(value);

function allowedRoute(method: string, path: string[]) {
  const number = /^\d{1,9}$/.test(path[0] ?? "") && Number(path[0]) > 0;
  if (path.length === 0) return method === "GET" || method === "POST";
  if (path.length === 1 && number) return method === "GET" || method === "PATCH";
  if (path.length === 2 && number && path[1] === "compare") return method === "GET";
  if (path.length === 2 && number && path[1] === "merge") return method === "POST";
  return false;
}

async function proxy(request: NextRequest, context: Context) {
  const { owner, repo, path = [] } = await context.params;
  const responseHeaders = { "content-type": "application/json", "cache-control": "private, no-store" };
  if (!validOwner(owner) || !validRepo(repo) || !allowedRoute(request.method, path)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Không tìm thấy endpoint." } }, { status: 404, headers: responseHeaders });
  }

  const appOrigin = (process.env.APP_ORIGIN ?? request.nextUrl.origin).replace(/\/$/, "");
  if (request.method !== "GET" && request.headers.get("origin") !== appOrigin) {
    return NextResponse.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Nguồn gửi yêu cầu không được phép." } }, { status: 403, headers: responseHeaders });
  }

  const headers = new Headers({ accept: "application/json", origin: appOrigin });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  try {
    const suffix = path.length ? `/${path.map(encodeURIComponent).join("/")}` : "";
    const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "");
    const upstream = await fetch(
      `${backendUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls${suffix}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: withBackendClientIp(request, headers),
        ...(request.method === "GET" ? {} : { body: await request.text() }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: { code: "BACKEND_UNAVAILABLE", message: "Backend tạm thời không thể kết nối." } }, { status: 503, headers: responseHeaders });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
