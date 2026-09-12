import { NextRequest, NextResponse } from "next/server";

const actions = new Set(["register", "login", "refresh", "logout", "me"]);

function backendUrl(): string {
  return (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: {} } }, { status });
}

async function proxy(request: NextRequest, action: string): Promise<NextResponse> {
  if (!actions.has(action)) return error(404, "NOT_FOUND", "Endpoint không tồn tại.");
  if (request.method === "GET" && action !== "me") return error(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  if (request.method === "POST" && action === "me") return error(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");

  const appOrigin = (process.env.APP_ORIGIN ?? request.nextUrl.origin).replace(/\/$/, "");
  if (request.method !== "GET" && request.headers.get("origin") !== appOrigin) {
    return error(403, "ORIGIN_NOT_ALLOWED", "Nguồn gửi yêu cầu không được phép.");
  }

  const headers = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");
  const contentType = request.headers.get("content-type");
  if (cookie) headers.set("cookie", cookie);
  if (contentType) headers.set("content-type", contentType);
  if (request.method !== "GET") headers.set("origin", appOrigin);

  try {
    const upstream = await fetch(`${backendUrl()}/api/v1/auth/${action}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const response = new NextResponse(upstream.body, { status: upstream.status });
    const responseType = upstream.headers.get("content-type");
    if (responseType) response.headers.set("content-type", responseType);
    const setCookies = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const value of setCookies) response.headers.append("set-cookie", value);
    return response;
  } catch {
    return error(503, "BACKEND_UNAVAILABLE", "Backend đang khởi động hoặc tạm thời không thể kết nối.");
  }
}

type Context = { params: Promise<{ action: string }> };

export async function GET(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).action);
}

export async function POST(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).action);
}
