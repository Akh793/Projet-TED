import express = require("express");
import cors = require("cors");
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const mcp = new McpServer({ name: "ted-mcp", version: "1.0.0" });

mcp.tool(
  "ted_search",
  "Recherche d'avis TED (tedeuropa) via expert query",
  {
    query: z.string().describe("Expert query TED. Ex: cpv=43130000 AND buyer-country=FR"),
    fields: z.array(z.string()).default([
      "notice-id",
      "title",
      "buyer-name",
      "buyer-country",
      "publication-date",
      "deadline-date",
      "cpv",
      "document-url"
    ]),
    limit: z.number().int().min(1).max(250).default(50)
  },
  async ({ query, fields, limit }) => {
    try {
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
      return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Fetch failed: ${e?.message || e}` }] };
    }
  }
);

// ---- Wiring HTTP/SSE pour MCP ----
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
app.listen(PORT, () => {
  console.log(`MCP server on :${PORT}/sse`);
});
