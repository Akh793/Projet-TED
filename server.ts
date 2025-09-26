import * as express from "express";
import cors from "cors";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const mcp = new McpServer({ name: "ted-mcp", version: "1.0.0" });

mcp.tool(
  "ted_search",
  "Recherche d'avis TED (tedeuropa) via expert query",
  {
    query: z.string().describe("Expert query TED, ex: cpv=43130000 AND buyer-country=FR"),
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
    if (!r.ok) {
      const t = await r.text();
      return { content: [{ type: "text", text: `TED error ${r.status}: ${t}` }] };
    }
    const json = await r.json();
    return { content: [{ type: "json", json }] };
  }
);

// --- Wiring HTTP/SSE pour MCP ---
const transports = new Map<string, SSEServerTransport>();
app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));
  await mcp.connect(transport);
});
app.post("/messages", async (req, res) => {
  const sid = String(req.query.sessionId || "");
  const t = transports.get(sid);
  if (!t) return res.status(400).send("invalid sessionId");
  await t.handlePostMessage(req, res, req.body);
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`MCP server on :${PORT}/sse`));

