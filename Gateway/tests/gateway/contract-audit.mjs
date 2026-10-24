// Contract regression checks. Exit 1 means a contract or isolation check failed.
// Run after building: node tests/gateway/contract-audit.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(gatewayRoot, "bin/Debug/net8.0");
const user = "7bc4918a-9079-4ea2-9e8e-369ad79a9f20";
const processes = [];
const servers = [];
const results = [];
const redirectedRequests = [];
let dependenciesReady = false;

async function listen(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return "http://127.0.0.1:" + server.address().port;
}

async function check(name, action) {
  try {
    await action();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, passed: false });
    console.log("FAIL " + name + ": " + error.message);
  }
}

async function request(base, path, options = {}) {
  return fetch(base + path, {
    ...options,
    headers: { "X-Dev-User-Id": user, ...options.headers },
    signal: AbortSignal.timeout(5000)
  });
}

async function startGateway(environment, mock) {
  const env = {
    ...process.env,
    ASPNETCORE_ENVIRONMENT: environment,
    DOTNET_ENVIRONMENT: environment,
    Gateway__DevelopmentAuth__Enabled: "true",
    Gateway__RequestTimeoutSeconds: "1",
    Gateway__ServiceCredentials__AdviceService: "audit-service-key",
    Gateway__ServiceCredentials__ContactContextService: "audit-context-key"
  };
  for (const service of ["expression-style-service", "contact-context-service", "advice-service", "analysis-service"]) {
    env["Gateway__Services__" + service + "__BaseUrl"] = mock;
    env["Gateway__Services__" + service + "__GatewayKey"] = "audit-" + service;
  }
  const child = spawn("dotnet", ["SocialAssistant.Gateway.dll", "--urls", "http://127.0.0.1:0"], {
    cwd: output, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  processes.push(child);
  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  child.on("error", error => { logs += error.message; });
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = logs.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) return match[1];
    if (child.exitCode !== null) break;
    await delay(50);
  }
  throw new Error("Gateway did not start: " + logs);
}

const internalHeaders = {
  "X-Service-Name": "AdviceService",
  "X-Service-Key": "audit-service-key",
  "X-Acting-User-Id": user
};

try {
  const redirectSink = await listen((req, res) => {
    redirectedRequests.push(req.headers);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ headers: req.headers }));
  });
  const mock = await listen(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const probe = url.searchParams.get("probe");
    for await (const chunk of req) { /* Drain forwarded request bodies. */ }
    if (url.pathname === "/healthz" || url.pathname === "/readyz") {
      res.writeHead(url.pathname === "/healthz" || dependenciesReady ? 200 : 503);
      res.end();
      return;
    }
    if (probe === "disconnect") {
      req.socket.destroy();
      return;
    }
    if (probe === "business-error" || probe === "rate-error") {
      const limited = probe === "rate-error";
      res.writeHead(limited ? 429 : 422, {
        "Content-Type": "application/json",
        "X-Correlation-Id": "unexpected-upstream-trace",
        ...(limited ? { "Retry-After": "7" } : {})
      });
      res.end(JSON.stringify({ data: null, error: {
        code: limited ? "RATE_LIMITED" : "CONTEXT_SCOPE_INVALID",
        message: "测试业务失败", details: { invalidRefs: ["message:test-ref"] }
      }, traceId: "unexpected-upstream-trace" }));
      return;
    }
    if (probe === "malformed-error" || probe === "large-error") {
      res.writeHead(probe === "malformed-error" ? 400 : 500, { "Content-Type": "application/json" });
      res.end(probe === "malformed-error" ? '{"data":' : "diagnostic-secret".repeat(5000));
      return;
    }
    if (probe === "delayed-error") {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.flushHeaders();
      await delay(1600);
      res.end("late upstream error");
      return;
    }
    if (probe === "plain-error") {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("upstream failure");
      return;
    }
    if (probe === "redirect") {
      res.writeHead(302, { Location: redirectSink + "/capture" });
      res.end();
      return;
    }
    if (probe === "delayed-headers") await delay(1600);
    res.setHeader("Content-Type", "application/json");
    if (probe === "set-cookie") res.setHeader("Set-Cookie", "audit-user=first-user; Path=/");
    if (probe === "delayed-body") {
      res.flushHeaders();
      await delay(1600);
    }
    if (probe === "partial-body") {
      res.write('{"partial":');
      await delay(1600);
      res.end('"late"}');
      return;
    }
    res.end(JSON.stringify({ headers: req.headers, url: req.url, method: req.method }));
  });
  const gateway = await startGateway("Development", mock);

  await check("all public routes in contract section 5 reach the correct service", async () => {
    const contract = await readFile(resolve(gatewayRoot, "../contract.md"), "utf8");
    const section = contract.split("## 5. API 目录")[1].split("### 5.1")[0];
    const entries = [...section.matchAll(/\| `(GET|PUT|POST|PATCH|DELETE)` \| `([^`]+)` \|[^|]+\| ([^|]+)\|/g)];
    assert.ok(entries.length > 20, "Public route table was not found");
    const services = { ExpressionStyleService: "expression-style-service", ContactContextService: "contact-context-service", AdviceService: "advice-service" };
    for (const [, method, route, owner] of entries) {
      const target = Object.entries(services).find(([name]) => owner.trim().startsWith(name))[1];
      const path = "/api/v1" + route.replace(/\{[^}]+\}/g, user);
      const response = await request(gateway, path, { method });
      assert.equal(response.status, 200, method + " " + path);
      assert.equal((await response.json()).headers["x-gateway-key"], "audit-" + target, path);
    }
    console.log("  Verified " + entries.length + " method/path entries from contract.md");
  });
  await check("browser identity cannot call INTERNAL analysis", async () => {
    assert.equal((await request(gateway, "/internal/v1/analysis", { method: "POST" })).status, 403);
  });
  await check("all INTERNAL routes enforce the documented caller and target service", async () => {
    const contract = await readFile(resolve(gatewayRoot, "../contract.md"), "utf8");
    const section = contract.split("### 3.6 INTERNAL 路由与身份")[1].split("内部调用约束：")[0];
    const entries = [...section.matchAll(/\| `(GET|POST|DELETE)` \| `([^`]+)` \| (\w+) \| (\w+) \|/g)];
    assert.equal(entries.length, 5);
    const services = { ExpressionStyleService: "expression-style-service", ContactContextService: "contact-context-service", AdviceService: "advice-service", AnalysisService: "analysis-service" };
    for (const [, method, route, caller, target] of entries) {
      const path = route.replace(/\{[^}]+\}/g, user);
      const key = caller === "AdviceService" ? "audit-service-key" : "audit-context-key";
      const response = await request(gateway, path, {
        method, headers: { ...internalHeaders, "X-Service-Name": caller, "X-Service-Key": key }
      });
      assert.equal(response.status, 200, method + " " + path);
      assert.equal((await response.json()).headers["x-gateway-key"], "audit-" + services[target]);
      const deniedCaller = caller === "AdviceService" ? "ContactContextService" : "AdviceService";
      const deniedKey = deniedCaller === "AdviceService" ? "audit-service-key" : "audit-context-key";
      assert.equal((await request(gateway, path, {
        method, headers: { ...internalHeaders, "X-Service-Name": deniedCaller, "X-Service-Key": deniedKey }
      })).status, 403, path + " accepted the wrong caller");
    }
  });
  await check("canonical AdviceService can call INTERNAL analysis", async () => {
    assert.equal((await request(gateway, "/internal/v1/analysis", { method: "POST", headers: internalHeaders })).status, 200);
  });
  await check("service caller identity is case sensitive (contract 3.6)", async () => {
    const response = await request(gateway, "/internal/v1/analysis", {
      method: "POST", headers: { ...internalHeaders, "X-Service-Name": "adviceservice" }
    });
    assert.equal(response.status, 403);
  });
  await check("forwarded correlation ID has exactly one value", async () => {
    const response = await request(gateway, "/api/v1/contacts", { headers: { "X-Correlation-Id": "audit-trace" } });
    assert.equal((await response.json()).headers["x-correlation-id"], "audit-trace");
  });
  await check("generated response and upstream correlation IDs match", async () => {
    const response = await request(gateway, "/api/v1/contacts");
    assert.equal((await response.json()).headers["x-correlation-id"], response.headers.get("x-correlation-id"));
  });
  await check("plain upstream errors become the contract error envelope", async () => {
    const response = await request(gateway, "/api/v1/contacts?probe=plain-error");
    assert.equal(response.status, 500);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const body = await response.json();
    assert.equal(body.data, null);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(body.traceId, response.headers.get("x-correlation-id"));
  });
  await check("business errors retain status/code/details and share the Gateway trace", async () => {
    const response = await request(gateway, "/api/v1/contacts?probe=business-error", { headers: { "X-Correlation-Id": "business-trace" } });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.data, null);
    assert.equal(body.error.code, "CONTEXT_SCOPE_INVALID");
    assert.deepEqual(body.error.details.invalidRefs, ["message:test-ref"]);
    assert.equal(body.traceId, "business-trace");
    assert.equal(response.headers.get("x-correlation-id"), "business-trace");
  });
  await check("normalized rate errors preserve Retry-After", async () => {
    const response = await request(gateway, "/api/v1/contacts?probe=rate-error");
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "7");
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
  });
  await check("malformed and oversized error bodies are replaced without diagnostic leakage", async () => {
    for (const [probe, status, code] of [["malformed-error", 400, "VALIDATION_ERROR"], ["large-error", 500, "INTERNAL_ERROR"]]) {
      const response = await request(gateway, "/api/v1/contacts?probe=" + probe);
      const text = await response.text();
      assert.equal(response.status, status);
      assert.equal(JSON.parse(text).error.code, code);
      assert.ok(!text.includes("diagnostic-secret"));
    }
  });
  await check("malformed resource UUID returns 400 VALIDATION_ERROR", async () => {
    const response = await request(gateway, "/api/v1/contacts/not-a-uuid");
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  });
  await check("UUID v4 formatting is enforced while unknown paths stay 404", async () => {
    for (const id of [user.toUpperCase(), "00000000-0000-0000-0000-000000000000", user.replace("-4ea2-", "-1ea2-"), user.replace("-9e8e-", "-7e8e-"), user.replaceAll("-", "")]) {
      assert.equal((await request(gateway, "/api/v1/contacts/" + id)).status, 400, id);
    }
    assert.equal((await request(gateway, "/api/v1/unknown/" + user)).status, 404);
  });
  await check("unsupported methods return 405 with the Allow header", async () => {
    const response = await request(gateway, "/api/v1/contacts", { method: "PUT" });
    assert.equal(response.status, 405);
    assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
    assert.deepEqual(response.headers.get("allow").split(/,\s*/).sort(), ["GET", "POST"]);
  });
  await check("Gateway readiness fails when a required dependency is not ready", async () => {
    assert.equal((await request(gateway, "/readyz")).status, 503);
  });
  await check("model connection timeout uses MODEL_TIMEOUT", async () => {
    const response = await request(gateway, "/internal/v1/analysis?probe=delayed-headers", { method: "POST", headers: internalHeaders });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, "MODEL_TIMEOUT");
  });
  await check("an unavailable analysis service uses MODEL_UNAVAILABLE", async () => {
    const response = await request(gateway, "/internal/v1/analysis?probe=disconnect", { method: "POST", headers: internalHeaders });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "MODEL_UNAVAILABLE");
  });
  await check("configured timeout also bounds response body reads", async () => {
    const started = performance.now();
    const response = await request(gateway, "/api/v1/contacts?probe=delayed-body");
    try { await response.text(); } catch { /* Abort is acceptable after headers are sent. */ }
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1450, "Body completed after " + Math.round(elapsed) + "ms despite a 1s timeout");
  });
  await check("a partial success body is aborted when its budget expires", async () => {
    const response = await request(gateway, "/api/v1/contacts?probe=partial-body");
    assert.equal(response.status, 200);
    await assert.rejects(() => response.text());
  });
  await check("the timeout budget also bounds error body reads", async () => {
    const response = await request(gateway, "/internal/v1/analysis?probe=delayed-error", { method: "POST", headers: internalHeaders });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, "MODEL_TIMEOUT");
  });
  await check("downstream redirects cannot forward the service key to another origin", async () => {
    const before = redirectedRequests.length;
    const response = await request(gateway, "/api/v1/contacts?probe=redirect");
    await response.text();
    assert.equal(redirectedRequests.length, before, "Redirect destination received X-Gateway-Key=" + redirectedRequests.at(-1)?.["x-gateway-key"]);
  });
  await check("downstream cookies are not shared between different users", async () => {
    await (await request(gateway, "/api/v1/contacts?probe=set-cookie")).text();
    const response = await request(gateway, "/api/v1/contacts", { headers: { "X-Dev-User-Id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
    assert.equal((await response.json()).headers.cookie, undefined);
  });
  const production = await startGateway("Production", mock);
  await check("production rejects the development identity header even when enabled by configuration", async () => {
    assert.equal((await request(production, "/api/v1/contacts")).status, 401);
  });
  await check("production still accepts authenticated INTERNAL calls", async () => {
    assert.equal((await request(production, "/internal/v1/analysis", { method: "POST", headers: internalHeaders })).status, 200);
  });
  await check("Gateway readiness recovers when all dependencies are ready", async () => {
    dependenciesReady = true;
    assert.equal((await request(gateway, "/healthz")).status, 200);
    assert.equal((await request(gateway, "/readyz")).status, 200);
  });
} finally {
  for (const child of processes) {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

const failures = results.filter(result => !result.passed).length;
console.log("Audit: " + (results.length - failures) + " passed, " + failures + " deviations.");
process.exitCode = failures ? 1 : 0;
