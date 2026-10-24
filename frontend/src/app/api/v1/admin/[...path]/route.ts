import { NextRequest, NextResponse } from "next/server";
import { withBackendClientIp } from "@/lib/backend-client-ip";

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, context: Context) {
  const path = (await context.params).path.map(encodeURIComponent).join("/");
  const appOrigin = (process.env.APP_ORIGIN ?? request.nextUrl.origin).replace(/\/$/, "");
  if (request.method !== "GET" && request.headers.get("origin") !== appOrigin) {
    return NextResponse.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Nguồn gửi yêu cầu không được phép." } }, { status: 403 });
  }

  const headers = new Headers({ accept: "application/json", origin: appOrigin });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  try {
    const upstream = await fetch(
      `${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/admin/${path}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: withBackendClientIp(request, headers),
        ...(request.method === "GET" ? {} : { body: await request.text() }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: { code: "BACKEND_UNAVAILABLE", message: "Backend tạm thời không thể kết nối." } }, { status: 503 });
  }
}

export const GET = forward;
export const PATCH = forward;
export const POST = forward;
