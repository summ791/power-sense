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
    expect(payload.messages[0].content).toContain("Answer the latest question directly in the first sentence");
    expect(payload.messages[0].content).toContain("normally no more than 45 words");
    expect(payload.messages[0].content).toContain("Add at most one brief, relevant sentence starting with \"Tip:\"");
    expect(payload.messages[0].content).toContain("Use **bold** sparingly");
    expect(payload.max_tokens).toBe(220);
    expect(payload.temperature).toBe(0.2);
    expect(payload.messages.at(-1)).toEqual({ role: "user", content: "How do I read my bill?" });
    expect(payload.messages.some((message: { content: string }) => message.content.includes("test-only-secret"))).toBe(false);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("requires a valid signed-in session before reading account bills", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    await chatHandler(createRequest({ ...validBody, includeBillContext: true }), res);

    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body).toEqual({ error: "A valid account session is required." });
  });

  it("loads only the signed-in user's limited bill summary and strips identifiers before OpenRouter", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.stubEnv("VITE_SUPABASE_URL", "https://power-sense-test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
    const privateRow = {
      billing_date: "2026-09-30",
      billing_period: "01 Aug 2026 - 30 Sep 2026",
      previous_reading: 1500,
      current_reading: 1700,
      units_consumed: 200,
      energy_charge: 0,
      fixed_charge: 0,
      tax: 0,
      other_charge: 0,
      total_amount: 0,
      tariff_data: { category: "residential", description: "Domestic LT-IA" },
      customer_name: "Private Test Person",
      consumer_number: "987654321",
      meter_number: "METER-SECRET",
      source_file_path: "user-id/private-bill.pdf",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "user-id", email: "private@example.test" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [privateRow] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Your saved record shows 200 units." } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = createResponse();

    const request = createRequest({
      ...validBody,
      includeBillContext: true,
    });
    request.headers.authorization = "Bearer valid-supabase-session-token";
    await chatHandler(request, res);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [authUrl, authInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(authUrl)).toBe("https://power-sense-test.supabase.co/auth/v1/user");
    expect(new Headers(authInit.headers).get("authorization")).toBe("Bearer valid-supabase-session-token");
    const [billsUrl, billsInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    const query = new URL(String(billsUrl));
    expect(query.pathname).toBe("/rest/v1/bills");
    expect(query.searchParams.get("user_id")).toBe("eq.user-id");
    expect(query.searchParams.get("limit")).toBe("12");
    expect(query.searchParams.get("select")).toBe("billing_date,billing_period,previous_reading,current_reading,units_consumed,energy_charge,fixed_charge,tax,other_charge,total_amount,tariff_data");
    expect(new Headers(billsInit.headers).get("authorization")).toBe("Bearer valid-supabase-session-token");
    const [, openRouterInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const upstreamBody = JSON.parse(String(openRouterInit.body));
    const systemContent = upstreamBody.messages[0].content as string;
    expect(JSON.stringify(upstreamBody)).not.toContain("valid-supabase-session-token");
    expect(systemContent).toContain('"period":"Sep 2026"');
    expect(systemContent).toContain('"units":200');
    expect(systemContent).toContain('"category":"residential"');
    expect(systemContent).not.toContain("Private Test Person");
    expect(systemContent).not.toContain("987654321");
    expect(systemContent).not.toContain("METER-SECRET");
    expect(systemContent).not.toContain("private-bill.pdf");
    expect(systemContent).not.toContain("private@example.test");
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
