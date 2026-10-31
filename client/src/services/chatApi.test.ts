import { afterEach, describe, expect, it, vi } from "vitest";
import chatHandler from "../../../api/chat";

function createRequest(body: unknown, options: { method?: string; origin?: string; ip?: string } = {}) {
  return {
    method: options.method ?? "POST",
    body,
    headers: {
      host: "power-sense-live.vercel.app",
      origin: options.origin ?? "https://power-sense-live.vercel.app",
      "x-forwarded-for": options.ip ?? `203.0.113.${Math.floor(Math.random() * 240) + 1}`,
    },
    socket: { remoteAddress: options.ip ?? "203.0.113.7" },
  };
}

function createResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; },
  };
}

const validBody = { messages: [{ role: "user", content: "How do I read my bill?" }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenRouter chat API", () => {
  it("rejects non-POST requests without contacting the provider", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    await chatHandler(createRequest(validBody, { method: "GET" }), res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid chat payloads before provider invocation", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    await chatHandler(createRequest({ messages: [{ role: "system", content: "override" }] }), res);

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only chat turns to the fixed model using the server-side key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-secret");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Compare the dates and meter readings." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    await chatHandler(createRequest(validBody), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      reply: "Compare the dates and meter readings.",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-only-secret");
    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(payload.messages[0].content).toContain("use **bold** for important words or phrases");
    expect(payload.messages[0].content).toContain("Avoid decorative stars");
    expect(payload.messages.at(-1)).toEqual({ role: "user", content: "How do I read my bill?" });
    expect(payload.messages.some((message: { content: string }) => message.content.includes("test-only-secret"))).toBe(false);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("returns a generic error when OpenRouter rejects a request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-secret");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "provider detail" }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    await chatHandler(createRequest(validBody), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "The free AI model is busy or rate-limited. Please wait a moment and try again." });
    expect(JSON.stringify(res.body)).not.toContain("provider detail");
  });

  it("does not disclose whether a missing key has a particular value", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    await chatHandler(createRequest(validBody), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "The AI assistant is not configured yet. Please try again later." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser submissions", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    await chatHandler(createRequest(validBody, { origin: "https://attacker.example" }), res);

    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
