import http from "node:http";

const port = Number(process.argv[2] ?? 5101);

const server = http.createServer(async (request, response) => {
  if (request.url === "/healthz" || request.url === "/readyz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "healthy" }));
    return;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  response.writeHead(200, {
    "content-type": "application/json",
    "x-upstream": "gateway-contract-test"
  });
  response.end(JSON.stringify({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: body.length > 0 ? JSON.parse(body) : null
  }));
});

server.listen(port, "127.0.0.1");
