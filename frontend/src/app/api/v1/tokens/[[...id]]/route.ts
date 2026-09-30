import { NextRequest, NextResponse } from "next/server";

type Context = { params: Promise<{ id?: string[] }> };
async function proxy(request: NextRequest, context: Context) {
  const { id = [] } = await context.params;
  const headers = { "content-type": "application/json", "cache-control": "private, no-store" };
  if (!(id.length === 0 && ["GET", "POST"].includes(request.method)) &&
    !(request.method === "DELETE" && id.length === 1 && /^[a-f0-9-]{36}$/i.test(id[0]))) {
    return NextResponse.json({ error: { message: "Không tìm thấy endpoint." } }, { status: 404, headers });
  }
  const origin = (process.env.APP_ORIGIN ?? request.nextUrl.origin).replace(/\/$/, "");
  if (request.method !== "GET" && request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: { message: "Nguồn gửi yêu cầu không được phép." } }, { status: 403, headers });
  }
  try {
    const upstream = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/tokens${id.length ? `/${id[0]}` : ""}`, {
      method: request.method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { cookie: request.headers.get("cookie") ?? "", origin, "content-type": "application/json" },
      ...(request.method === "POST" ? { body: await request.text() } : {}),
    });
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: { message: "Máy chủ tạm thời không thể kết nối. Vui lòng thử lại." } }, { status: 503, headers });
  }
}
export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
