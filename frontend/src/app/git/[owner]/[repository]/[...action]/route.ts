import { NextRequest } from "next/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ owner: string; repository: string; action: string[] }> };

async function transport(request: NextRequest, context: Context) {
  const { owner, repository, action } = await context.params;
  const path = action.join("/");
  const headers = new Headers({ "cache-control": "private, no-store", "content-type": "text/plain" });
  if (!/^[a-z0-9][a-z0-9._-]{1,37}[a-z0-9]$/i.test(owner) ||
    !/^(?!.*\.\.)(?!.*\.git\.git$)[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?\.git$/i.test(repository) ||
    !((request.method === "GET" && path === "info/refs") || (request.method === "POST" && path === "git-upload-pack"))) {
    return new Response("Git request unavailable.\n", { status: 404, headers });
  }
  const upstreamHeaders = new Headers();
  for (const name of ["content-type", "content-encoding", "git-protocol"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  const timer = setTimeout(cancel, 95_000);
  const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); };
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method, headers: upstreamHeaders, cache: "no-store", redirect: "error", signal: controller.signal,
      ...(request.method === "POST" ? { body: request.body, duplex: "half" as const } : {}),
    };
    const upstream = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/git/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${path}${request.nextUrl.search}`, init);
    headers.set("content-type", upstream.headers.get("content-type") ?? "text/plain");
    headers.set("x-content-type-options", "nosniff");
    const reader = upstream.body?.getReader();
    if (!reader) { cleanup(); return new Response(null, { status: upstream.status, headers }); }
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const result = await reader.read();
          if (result.done) { cleanup(); stream.close(); }
          else stream.enqueue(result.value);
        } catch (error) { cleanup(); cancel(); stream.error(error); }
      },
      async cancel() { cleanup(); cancel(); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, { status: upstream.status, headers });
  } catch {
    cleanup(); cancel();
    return new Response("Git request unavailable.\n", { status: 503, headers });
  }
}

export const GET = transport;
export const POST = transport;
