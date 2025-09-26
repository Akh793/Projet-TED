import * as http from "http";
import * as url from "url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const mcp = new McpServer({ name: "ted-mcp", version: "1.0.0" });

// Tool: TED search
mcp.tool(
  "ted_search",
  "Recherche d'avis TED (tedeuropa) via expert query",
  {
    query: z.string(),
    fields: z.array(z.string()).default([
      "notice-id","title","buyer-name","buyer-country",
      "publication-date","deadline-date","cpv","document-url"
    ]),
    limit: z.number().int().min(1).max(250).default(50)
  },
  async ({ query, fields, limit }) => {
    const r = await fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, fields, limit })
    });
    if (!r.ok) return { content: [{ type: "text", text: `TED error ${r.status}` }] };
    const json = await r.json();
    return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] };
  }
);

const transports = new Map<string, SSEServerTransport>();

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const u = new url.URL(req.url || "/", `http://${req.headers.host}`);

  // root + health
  if ((u.pathname === "/" || u.pathname === "/health") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("OK");
  }

  // SSE
  if (u.pathname === "/sse" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const transport = new SSEServerTransport("/messages", res as any);
    transports.set(transport.sessionId, transport);
    req.on("close", () => transports.delete(transport.sessionId));
    await mcp.connect(transport);
    return;
  }

  // messages
  if (u.pathname === "/messages" && req.method === "POST") {
    const sid = u.searchParams.get("sessionId") || "";
    const t = transports.get(sid);
    if (!t) { res.statusCode = 400; return res.end("invalid sessionId"); }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};
    await t.handlePostMessage(req as any, res as any, body);
    return;
  }

  res.statusCode = 404;
  res.end("Not found");
});

const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, () => console.log(`MCP server on :${PORT}/sse`));
