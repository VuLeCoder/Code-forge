import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";

const appOrigin = "http://localhost:3111";
const backendOrigin = "http://127.0.0.1:4111";
const signingSecret = "playwright-only-signing-secret-at-least-32-characters";
const requestId = "11111111-1111-4111-8111-111111111111";

function postChunked(url: string, headers: Record<string, string>, chunks: string[]) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = httpRequest(url, { method: "POST", headers });
    outgoing.once("error", reject);
    outgoing.once("response", (incoming) => {
      incoming.setEncoding("utf8");
      let body = "";
      incoming.on("data", (chunk: string) => { body += chunk; });
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body }));
    });
    for (const chunk of chunks) outgoing.write(chunk);
    outgoing.end();
  });
}

test("PR proxy rejects invalid routes and origins before the upstream, and strips hostile headers", async ({ request }) => {
  const reset = await request.post(`${backendOrigin}/__test/pull-proxy/reset`, {
    data: {
      status: 422,
      headers: { "x-request-id": requestId },
      body: { error: { code: "UPSTREAM_VALIDATION_ERROR", message: "Fixture validation failure." }, requestId },
    },
  });
  expect(reset.status()).toBe(204);

  const invalidPath = await request.get(`${appOrigin}/api/v1/repos/alice/project/pulls/1/unlisted`);
  expect(invalidPath.status()).toBe(404);
  await expect(invalidPath.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });

  const invalidMethod = await request.post(`${appOrigin}/api/v1/repos/alice/project/pulls/1/compare`, {
    headers: { Origin: appOrigin, "Content-Type": "application/json" },
    data: {},
  });
  expect(invalidMethod.status()).toBe(404);

  const hostileOrigin = await request.post(`${appOrigin}/api/v1/repos/alice/project/pulls/1/merge`, {
    headers: { Origin: "https://attacker.invalid", Cookie: "session=fixture-session", "Content-Type": "application/json" },
    data: { operationId: "fixture-operation" },
  });
  expect(hostileOrigin.status()).toBe(403);
  await expect(hostileOrigin.json()).resolves.toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });

  const missingOrigin = await request.post(`${appOrigin}/api/v1/repos/alice/project/pulls/1/merge`, {
    headers: { Cookie: "session=fixture-session", "Content-Type": "application/json" },
    data: { operationId: "fixture-operation" },
  });
  expect(missingOrigin.status()).toBe(403);

  const requestsAfterRejectedCases = await request.get(`${backendOrigin}/__test/pull-proxy/requests`);
  await expect(requestsAfterRejectedCases.json()).resolves.toEqual([]);

  const upstream = await request.post(`${appOrigin}/api/v1/repos/alice/project/pulls/1/merge`, {
    headers: {
      Origin: appOrigin,
      Cookie: "session=fixture-session",
      Authorization: "Bearer hostile-authorization-canary",
      "X-Forwarded-For": "203.0.113.42",
      "X-Request-ID": "hostile-request-id-canary",
      "Content-Type": "application/json",
    },
    data: { operationId: "fixture-operation" },
  });

  expect(upstream.status()).toBe(422);
  await expect(upstream.json()).resolves.toEqual({
    error: { code: "UPSTREAM_VALIDATION_ERROR", message: "Fixture validation failure." }, requestId,
  });
  expect(upstream.headers()["x-request-id"]).toBe(requestId);

  const captured = await (await request.get(`${backendOrigin}/__test/pull-proxy/requests`)).json() as Array<{
    method: string;
    path: string;
    headers: Record<string, string | undefined>;
    body: string;
  }>;
  expect(captured).toHaveLength(1);
  expect(captured[0]).toMatchObject({ method: "POST", path: "/api/v1/repos/alice/project/pulls/1/merge" });
  expect(JSON.parse(captured[0]!.body)).toEqual({ operationId: "fixture-operation" });
  const headers = captured[0]!.headers;
  expect(headers.cookie).toBe("session=fixture-session");
  expect(headers.origin).toBe(appOrigin);
  expect(headers["x-codeforge-client-ip"]).toBe("203.0.113.42");
  expect(headers["x-codeforge-client-signature"]).toBe(
    createHmac("sha256", signingSecret).update("203.0.113.42", "utf8").digest("hex"),
  );
  expect(headers.authorization).toBeUndefined();
  expect(headers["x-forwarded-for"]).toBeUndefined();
  expect(headers["x-request-id"]).toBeUndefined();
});

test("PR proxy rejects an oversized mutation without forwarding it", async ({ request }) => {
  const reset = await request.post(`${backendOrigin}/__test/pull-proxy/reset`, { data: {} });
  expect(reset.status()).toBe(204);

  const oversizedBody = JSON.stringify({ title: "Oversized title", description: "x".repeat(33 * 1024),
    sourceBranch: "feature/demo", targetBranch: "main" });
  expect(Buffer.byteLength(oversizedBody)).toBeGreaterThan(32 * 1024);
  const response = await request.post(`${appOrigin}/api/v1/repos/alice/project/pulls`, {
    headers: { Origin: appOrigin, Cookie: "session=fixture-session", "Content-Type": "application/json" },
    data: oversizedBody,
  });

  expect(response.status()).toBe(413);
  await expect(response.json()).resolves.toMatchObject({ error: { code: "REQUEST_TOO_LARGE" } });
  const captured = await (await request.get(`${backendOrigin}/__test/pull-proxy/requests`)).json();
  expect(captured).toEqual([]);
});

test("PR proxy enforces its streaming cap when Content-Length is absent", async ({ request }) => {
  const reset = await request.post(`${backendOrigin}/__test/pull-proxy/reset`, { data: {} });
  expect(reset.status()).toBe(204);

  const result = await postChunked(`${appOrigin}/api/v1/repos/alice/project/pulls`, {
    Origin: appOrigin,
    Cookie: "session=fixture-session",
    "Content-Type": "application/json",
  }, ['{"title":"Oversized title","description":"', "x".repeat(33 * 1024), '"}']);
  expect(result.status).toBe(413);
  expect(JSON.parse(result.body)).toMatchObject({ error: { code: "REQUEST_TOO_LARGE" } });

  const captured = await (await request.get(`${backendOrigin}/__test/pull-proxy/requests`)).json();
  expect(captured).toEqual([]);
});
