// A round-robin load balancer: every request goes to the next server, so no two messages in a row reach the same one.
// In your project, this is nginx, a cloud load balancer or a Kubernetes Service – without sticky sessions.
import { createServer } from "node:http";
import { body, listen, type Server } from "./server.ts";

export async function startLoadBalancer(servers: Server[]): Promise<Server> {
  let next = 0;
  const balancer = createServer(async (request, response) => {
    const target = servers[next++ % servers.length]!;
    const forwarded = await fetch(`${target.url}${request.url}`, {
      method: request.method,
      headers: { "content-type": request.headers["content-type"] ?? "application/json" },
      body: await body(request),
    });
    response.writeHead(forwarded.status, {
      "content-type": forwarded.headers.get("content-type") ?? "application/json",
      "x-served-by": forwarded.headers.get("x-served-by") ?? "", // only for the transcript: which instance answered
    });
    response.end(await forwarded.text());
  });
  return listen(balancer);
}
