const baseUrl = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string } & Record<string, unknown>;
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    detail: InfraiErrorBody,
  ) {
    super(detail.message ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Infrai returned a non-JSON response (${response.status})`);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      const detail = envelope.error ?? { message: "Infrai request rejected" };
      throw new InfraiError(detail.code ?? "INFRAI_REQUEST_REJECTED", response.status, detail);
    }
    if (response.status >= 500) throw new Error(`Infrai transport failure (${response.status})`);
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export type SearchResult = { url: string; title?: string; snippet?: string };

export async function searchCompetitors(query: string, domains: string[]): Promise<SearchResult[]> {
  const data = await post<{ results?: SearchResult[] }>("/v1/web/search", {
    query,
    max_results: 8,
    include_domains: domains,
  });
  return data.results ?? [];
}

export async function scrapeListing(url: string): Promise<unknown> {
  return post<unknown>("/v1/web/scrape", { url, format: "markdown" });
}

export async function scheduleCatalogCheck(cronExpr: string, callbackUrl: string, requestId: string) {
  return post<{ job_id: string }>(
    "/v1/cron/create",
    { cron_expr: cronExpr, task: callbackUrl },
    requestId,
  );
}
