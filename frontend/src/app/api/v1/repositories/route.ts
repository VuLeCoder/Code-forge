import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const appOrigin = (process.env.APP_ORIGIN ?? request.nextUrl.origin).replace(/\/$/, "");
  if (request.headers.get("origin") !== appOrigin) {
    return NextResponse.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Nguồn gửi yêu cầu không được phép." } }, { status: 403 });
  }
  const headers = new Headers({ accept: "application/json", origin: appOrigin, "content-type": "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  try {
    const upstream = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/repositories`, {
      method: "POST", headers, body: await request.text(), cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    return new NextResponse(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "BACKEND_UNAVAILABLE", message: "Backend tạm thời không thể kết nối." } }, { status: 503 });
  }
}
