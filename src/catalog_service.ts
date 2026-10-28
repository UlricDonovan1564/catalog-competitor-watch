import { createServer, type ServerResponse } from "node:http";
import { ZodError, z } from "zod";
import { InfraiError, scheduleCatalogCheck, scrapeListing, searchCompetitors } from "./infrai.js";
import { catalogCheckSchema, decideCatalogAction, type CompetitorObservation } from "./price_monitor.js";

const scheduleSchema = z.object({
  cronExpr: z.string().min(1),
  callbackUrl: z.string().url(),
  requestId: z.string().min(8),
});

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function observationsFrom(markdown: unknown, domain: string, url: string): CompetitorObservation[] {
  const text = typeof markdown === "string" ? markdown : JSON.stringify(markdown);
  const match = text.match(/(?:USD|\$)\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  return match ? [{ domain, amount: Number(match[1]), url }] : [];
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/catalog/check") {
      const input = catalogCheckSchema.parse(await readJson(request));
      const results = await searchCompetitors(`${input.productName} ${input.sku}`, input.competitorDomains);
      const evidence = (await Promise.all(results.map(async (result) => {
        const domain = new URL(result.url).hostname;
        return observationsFrom(await scrapeListing(result.url), domain, result.url);
      }))).flat();
      return send(response, 200, decideCatalogAction(input, evidence));
    }

    if (request.method === "POST" && request.url === "/catalog/schedule") {
      const input = scheduleSchema.parse(await readJson(request));
      const scheduled = await scheduleCatalogCheck(input.cronExpr, input.callbackUrl, input.requestId);
      return send(response, 201, scheduled);
    }

    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError) return send(response, 400, { error: "Invalid request", issues: error.issues });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.code, detail: error.detail });
    }
    send(response, 500, { error: error instanceof Error ? error.message : "Unexpected error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Catalog monitor listening on http://localhost:${port}`));
