type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };
type RequestLike = {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(payload: unknown): void;
};

type RateLimitEntry = { count: number; resetAt: number };
const rateLimits = new Map<string, RateLimitEntry>();
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_TOTAL_CHARS = 10000;
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the Power Sense Assistant, an electricity-bill and energy-use guide for Tamil Nadu, India. Be concise, helpful, and transparent. Answer in the user's language. Do not claim to be the electricity provider or to issue official bills. Do not invent charges, current rules, or account-specific information; ask for missing details and label estimates as indicative. For other jurisdictions, state that Tamil Nadu rules do not apply.

Power Sense's configured Tamil Nadu tariff assumptions (not a substitute for the current provider bill):
- Residential/domestic LT-IA bi-monthly subsidy: up to and including 500 gross units receives 200 free units; above 500 gross units receives 100 free units. This subsidy is not applied to commercial or monthly-cycle estimates.
- Residential bi-monthly progressive consumer-payable rates apply after the eligible free-unit allowance: units 1-400 ₹4.70/unit; 401-500 ₹6.30; 501-600 ₹8.40; 601-800 ₹9.45; 801-1000 ₹10.50; above 1000 ₹11.55.
- Residential monthly rates: 1-200 ₹4.70/unit; 201-250 ₹6.30; 251-300 ₹8.40; 301-400 ₹9.45; 401-500 ₹10.50; above 500 ₹11.55. The configured monthly path has no bi-monthly subsidy.
- Commercial/general-purpose LT-V estimates use ₹6.45/unit up to 50 units per month equivalent, ₹10.15/unit for the next configured band, and ₹10.45/unit above it. Fixed charge is estimated by connected-load band (₹110/kW/month up to 50 kW; ₹332/kW/month through 112 kW; ₹608/kW/month above 112 kW), with 5% electricity tax. No domestic subsidy applies. Ask the user for cycle and connected load when needed.
- Meter consumption is normally the current meter reading minus the previous reading. The official provider bill controls final payable amounts and may include arrears, adjustments, or charges not modeled here.

Privacy and safety: Do not ask the user for their name, service/consumer ID, phone number, address, payment details, or confidential bill data. Power Sense sends chat turns to OpenRouter for this free NVIDIA model; avoid including personal or confidential information because the provider may log prompts for security and product improvement. Chats are not stored by the Power Sense website. For electrical hazards, shocks, fire, or downed wires, tell the user to contact their local electricity provider/emergency service immediately.`;

function sendError(res: ResponseLike, status: number, error: string) {
  res.status(status).json({ error });
}

function headerValue(req: RequestLike, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function originMatchesHost(req: RequestLike) {
  const origin = headerValue(req, "origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = (headerValue(req, "x-forwarded-host") ?? headerValue(req, "host") ?? "").split(",")[0].trim().toLowerCase();
    return Boolean(requestHost) && originHost === requestHost;
  } catch {
    return false;
  }
}

function getClientKey(req: RequestLike) {
  const forwarded = headerValue(req, "x-forwarded-for")?.split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown-client";
}

function isRateLimited(clientKey: string, now = Date.now()) {
  rateLimits.forEach((entry, key) => {
    if (entry.resetAt <= now) rateLimits.delete(key);
  });
  const current = rateLimits.get(clientKey);
  if (!current || current.resetAt <= now) {
    rateLimits.set(clientKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (current.count >= RATE_LIMIT_REQUESTS) return true;
  current.count += 1;
  return false;
}

function parseMessages(body: unknown): ChatMessage[] | null {
  let parsed = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { messages?: unknown }).messages)) return null;
  const input = (parsed as { messages: unknown[] }).messages;
  if (input.length === 0 || input.length > MAX_MESSAGES) return null;

  const messages: ChatMessage[] = [];
  let totalChars = 0;
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as { role?: unknown; content?: unknown };
    if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") return null;
    const content = candidate.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) return null;
    totalChars += content.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    messages.push({ role: candidate.role, content });
  }
  if (messages[messages.length - 1]?.role !== "user") return null;
  return messages;
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "Use POST to send a chat message.");
  }
  if (!originMatchesHost(req)) return sendError(res, 403, "Request origin is not allowed.");
  if (isRateLimited(getClientKey(req))) return sendError(res, 429, "Chat request limit reached. Please wait a minute and try again.");

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return sendError(res, 503, "The AI assistant is not configured yet. Please try again later.");

  const messages = parseMessages(req.body);
  if (!messages) return sendError(res, 400, "The chat request is invalid or too long. Please shorten your message and try again.");

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://power-sense-live.vercel.app",
        "X-OpenRouter-Title": "Power Sense",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 600,
        temperature: 0.25,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) return sendError(res, 502, "The AI provider could not authorize this request. Please check the server configuration.");
      if (upstream.status === 429) return sendError(res, 503, "The free AI model is busy or rate-limited. Please wait a moment and try again.");
      if (upstream.status === 402) return sendError(res, 503, "The AI provider is temporarily unable to serve this free model. Please try again later.");
      return sendError(res, 502, "The AI provider could not complete this request. Please try again.");
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    const reply = typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content.map((part) => part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "").join("").trim()
        : "";

    if (!reply) return sendError(res, 502, "The AI provider returned an empty response. Please try again.");
    return res.status(200).json({ reply, model: MODEL });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return sendError(res, timedOut ? 504 : 502, timedOut ? "The AI response took too long. Please try again." : "The AI provider is temporarily unavailable. Please try again.");
  }
}
