import { NextRequest, NextResponse } from "next/server";

const validUuid = (value: string) => /^[a-f0-9-]{36}$/i.test(value);

type Context = { params: Promise<{ action?: string[] }> };

async function proxy(request: NextRequest, context: Context) {
  const { action = [] } = await context.params;
  const headers = { "content-type": "application/json", "cache-control": "private, no-store" };

  const isList = action.length === 0 && request.method === "GET";
  const isAction = action.length === 2 && validUuid(action[0]) && ["accept", "decline"].includes(action[1]) && request.method === "POST";

  if (!isList && !isAction) {
    return NextResponse.json({ error: { message: "Không tìm thấy endpoint." } }, { status: 404, headers });
  }

  const origin = (process.env.APP_ORIGIN ?? request.nextUrl.origin).replace(/\/$/, "");
  if (request.method !== "GET" && request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: { message: "Nguồn gửi yêu cầu không được phép." } }, { status: 403, headers });
  }

  try {
    const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "");
    const subpath = action.length === 2 ? `/${action[0]}/${action[1]}` : "";
    const upstream = await fetch(`${backendUrl}/api/v1/invitations${subpath}`, {
      method: request.method,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        origin,
        "content-type": "application/json",
      },
    });
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: { message: "Máy chủ tạm thời không thể kết nối. Vui lòng thử lại." } }, { status: 503, headers });
  }
}

export const GET = proxy;
export const POST = proxy;
