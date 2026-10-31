type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };
type BillCategory = "residential" | "commercial" | "unknown";
type BillingCycle = "monthly" | "bi-monthly" | "unknown";
type BillSummary = {
  period: string;
  category: BillCategory;
  billingCycle: BillingCycle;
  units: number | null;
  totalAmount: number | null;
  energyCharge: number | null;
  fixedCharge: number | null;
  tax: number | null;
  otherCharge: number | null;
};
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
type ParsedPayload = { messages?: unknown; includeBillContext?: unknown };
type RateLimitEntry = { count: number; resetAt: number };

const rateLimits = new Map<string, RateLimitEntry>();
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_TOTAL_CHARS = 24000;
const MAX_ACCESS_TOKEN_LENGTH = 5000;
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_BILL_CONTEXT = 12;
const MAX_UNITS = 100_000_000;
const MAX_AMOUNT = 1_000_000_000;
const BILL_SELECT = "billing_date,billing_period,previous_reading,current_reading,units_consumed,energy_charge,fixed_charge,tax,other_charge,total_amount,tariff_data";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the Power Sense Assistant, an electricity-bill and energy-use guide for Tamil Nadu, India. Answer in the user's language.

Reply rules — follow these strictly:
- Answer the latest question directly in the first sentence. Do not repeat the question, greet again, or give unrelated background.
- Keep each reply to 1–3 short sentences, normally no more than 45 words. Add at most one brief, relevant sentence starting with "Tip:" when it genuinely helps.
- If the user asks a simple definition or fact, answer only that. If a key detail is missing, ask one short clarifying question instead of guessing.
- For personal bill questions, give only the relevant period and value(s) from the supplied summaries. If the data is absent, say so plainly.
- Use **bold** sparingly for important words. Avoid headings, long lists, tables, decorative symbols, emoji, and filler unless the user asks for detail.
- Be accurate and transparent. Do not claim to be the electricity provider or to issue official bills. Label tariff calculations as estimates. For other jurisdictions, state that Tamil Nadu rules do not apply.

Power Sense's configured Tamil Nadu tariff assumptions (not a substitute for the current provider bill):
- Residential/domestic LT-IA bi-monthly subsidy: up to and including 500 gross units receives 200 free units; above 500 gross units receives 100 free units. This subsidy is not applied to commercial or monthly-cycle estimates.
- Residential bi-monthly progressive consumer-payable rates apply after the eligible free-unit allowance: units 1-400 ₹4.70/unit; 401-500 ₹6.30; 501-600 ₹8.40; 601-800 ₹9.45; 801-1000 ₹10.50; above 1000 ₹11.55.
- Residential monthly rates: 1-200 ₹4.70/unit; 201-250 ₹6.30; 251-300 ₹8.40; 301-400 ₹9.45; 401-500 ₹10.50; above 500 ₹11.55. The configured monthly path has no bi-monthly subsidy.
- Commercial/general-purpose LT-V estimates use ₹6.45/unit up to 50 units per month equivalent, ₹10.15/unit for the next configured band, and ₹10.45/unit above it. Fixed charge is estimated by connected-load band (₹110/kW/month up to 50 kW; ₹332/kW/month through 112 kW; ₹608/kW/month above 112 kW), with 5% electricity tax. No domestic subsidy applies. Ask the user for cycle and connected load when needed.
- Meter consumption is normally the current meter reading minus the previous reading. The official provider bill controls final payable amounts and may include arrears, adjustments, or charges not modeled here.

Privacy and safety: Do not ask for or repeat the user's name, service/consumer ID, phone number, address, payment details, meter ID, or raw bill documents. When the signed-in user leaves saved-bill context on, use up to 12 non-identifying summaries only for bill-related questions. Use them only to answer the current question; do not infer identity. OpenRouter may log prompts; remind users not to include personal identifiers. Chats are not stored by Power Sense. For electrical hazards, tell the user to contact their local electricity provider or emergency services immediately.`;

export function asksForDetailedAnswer(messages: ChatMessage[]) {
  const latestQuestion = messages[messages.length - 1]?.content ?? "";
  return /\b(in detail|detailed(?:\s+(?:answer|explanation|steps?))?|more detail|more detailed|longer(?:\s+(?:answer|explanation|message|reply|response))?|long answer|longer message|more words|extended answer|explain fully|full explanation|step[- ]by[- ]step|elaborate|comprehensive|with examples|show (?:all )?(?:the )?steps)\b/i.test(latestQuestion);
}

class BillContextAuthError extends Error {}
class BillContextUnavailableError extends Error {}

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

function parsePayload(body: unknown): ParsedPayload | null {
  let parsed = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as ParsedPayload;
}

function parseMessages(body: unknown): ChatMessage[] | null {
  const parsed = parsePayload(body);
  if (!parsed || !Array.isArray(parsed.messages)) return null;
  const input = parsed.messages;
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

function isSafeNullableNumber(value: unknown, maximum: number): boolean {
  if (value === null || value === undefined || value === "") return true;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum;
}

function readNumber(value: unknown, maximum: number): number | null {
  if (!isSafeNullableNumber(value, maximum) || value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Math.round(parsed * 100) / 100;
}

function dateFromPeriod(value: string) {
  const iso = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${iso[1]}`;
  }
  const dmy = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (dmy) {
    const month = Number(dmy[2]);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${dmy[3]}`;
  }
  const monthYear = value.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(20\d{2})\b/i);
  if (monthYear) {
    const monthToken = monthYear[1] ?? "";
    const year = monthYear[2] ?? "";
    const month = MONTHS.find((item) => item.toLowerCase().startsWith(monthToken.slice(0, 3).toLowerCase()));
    if (month && year) return `${month} ${year}`;
  }
  return "Undated";
}

function inferCycle(period: string): BillingCycle {
  if (!period.trim()) return "unknown";
  if (/\bmonthly\b|\bone\s+month\b/i.test(period)) return "monthly";
  if (/\bbi[-\s]?monthly\b|\btwo\s+months?\b|\b2\s+months?\b/i.test(period)) return "bi-monthly";
  const matches = Array.from(period.matchAll(/\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\b/g));
  if (matches.length >= 2) {
    const parse = (text: string) => {
      const iso = text.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})$/);
      return dmy ? Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) : NaN;
    };
    const start = parse(matches[0][0]);
    const end = parse(matches[matches.length - 1][0]);
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.abs(end - start) / 86_400_000 < 35 ? "monthly" : "bi-monthly";
  }
  const monthHits = period.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+20\d{2}\b/gi) ?? [];
  if (monthHits.length >= 2) return (monthHits[0] ?? "").toLowerCase() === (monthHits[1] ?? "").toLowerCase() ? "monthly" : "bi-monthly";
  return "unknown";
}

function inferCategory(tariffData: unknown): BillCategory {
  if (!tariffData || typeof tariffData !== "object") return "unknown";
  const data = tariffData as { category?: unknown; description?: unknown };
  const text = `${String(data.category ?? "")} ${String(data.description ?? "")}`.toLowerCase();
  if (/commercial|general purpose|tariff v|lt[- ]?v/.test(text)) return "commercial";
  if (/residential|domestic|tariff a|lt[- ]?ia/.test(text)) return "residential";
  return "unknown";
}

function buildBillSummary(row: Record<string, unknown>): BillSummary | null {
  const billingDate = typeof row.billing_date === "string" ? row.billing_date : "";
  const billingPeriod = typeof row.billing_period === "string" ? row.billing_period : "";
  const previous = readNumber(row.previous_reading, MAX_UNITS);
  const current = readNumber(row.current_reading, MAX_UNITS);
  const derivedUnits = previous !== null && current !== null && current >= previous ? current - previous : null;
  const units = readNumber(row.units_consumed, MAX_UNITS) ?? (derivedUnits === null ? null : Math.round(derivedUnits * 100) / 100);
  const energyCharge = readNumber(row.energy_charge, MAX_AMOUNT);
  const fixedCharge = readNumber(row.fixed_charge, MAX_AMOUNT);
  const tax = readNumber(row.tax, MAX_AMOUNT);
  const otherCharge = readNumber(row.other_charge, MAX_AMOUNT);
  const storedTotalAmount = readNumber(row.total_amount, MAX_AMOUNT);
  const charges = [energyCharge, fixedCharge, tax, otherCharge];
  const totalAmount = storedTotalAmount ?? (charges.some((value) => value !== null)
    ? charges.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null);

  if (units === null && totalAmount === null) return null;
  return {
    period: dateFromPeriod(billingDate || billingPeriod),
    category: inferCategory(row.tariff_data),
    billingCycle: inferCycle(billingPeriod),
    units,
    totalAmount: totalAmount === null ? null : Math.round(totalAmount * 100) / 100,
    energyCharge,
    fixedCharge,
    tax,
    otherCharge,
  };
}

async function loadOwnBillSummaries(payload: ParsedPayload, req: RequestLike): Promise<BillSummary[]> {
  if (payload.includeBillContext !== true) return [];
  const authorization = headerValue(req, "authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i)?.[1];
  if (!accessToken || accessToken.length > MAX_ACCESS_TOKEN_LENGTH) {
    throw new BillContextAuthError("A valid account session is required.");
  }

  const supabaseUrlValue = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrlValue || !anonKey) throw new BillContextUnavailableError("Account data is unavailable.");
  let baseUrl: URL;
  try {
    baseUrl = new URL(supabaseUrlValue);
    if (baseUrl.protocol !== "https:" || !baseUrl.hostname.endsWith(".supabase.co")) throw new Error("Invalid endpoint");
  } catch {
    throw new BillContextUnavailableError("Account data is unavailable.");
  }
  const headers = { apikey: anonKey, Authorization: `Bearer ${accessToken}` };
  let authResponse: Response;
  try {
    authResponse = await fetch(new URL("/auth/v1/user", baseUrl), { headers, signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new BillContextUnavailableError("Account data is unavailable.");
  }
  if (authResponse.status === 401 || authResponse.status === 403) throw new BillContextAuthError("Your account session expired. Sign in again to ask about saved bills.");
  if (!authResponse.ok) throw new BillContextUnavailableError("Account data is unavailable.");

  let authUser: unknown;
  try {
    authUser = await authResponse.json();
  } catch {
    throw new BillContextAuthError("Your account session could not be verified.");
  }
  if (!authUser || typeof authUser !== "object" || typeof (authUser as { id?: unknown }).id !== "string") {
    throw new BillContextAuthError("Your account session could not be verified.");
  }
  const userId = (authUser as { id: string }).id;
  const billsUrl = new URL("/rest/v1/bills", baseUrl);
  billsUrl.searchParams.set("select", BILL_SELECT);
  billsUrl.searchParams.set("user_id", `eq.${userId}`);
  billsUrl.searchParams.set("order", "billing_date.desc.nullslast");
  billsUrl.searchParams.set("limit", String(MAX_BILL_CONTEXT));

  let billsResponse: Response;
  try {
    billsResponse = await fetch(billsUrl, { headers, signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new BillContextUnavailableError("Saved bills could not be loaded securely.");
  }
  if (billsResponse.status === 401 || billsResponse.status === 403) throw new BillContextAuthError("Your account no longer has access to these bills.");
  if (!billsResponse.ok) throw new BillContextUnavailableError("Saved bills could not be loaded securely.");

  let rows: unknown;
  try {
    rows = await billsResponse.json();
  } catch {
    throw new BillContextUnavailableError("Saved bills could not be loaded securely.");
  }
  if (!Array.isArray(rows)) throw new BillContextUnavailableError("Saved bills could not be loaded securely.");
  return rows
    .slice(0, MAX_BILL_CONTEXT)
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map(buildBillSummary)
    .filter((summary): summary is BillSummary => summary !== null);
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

  const payload = parsePayload(req.body);
  const messages = parseMessages(req.body);
  if (!payload || !messages) return sendError(res, 400, "The chat request is invalid or too long. Please shorten your message and try again.");

  let billContext: BillSummary[];
  try {
    billContext = await loadOwnBillSummaries(payload, req);
  } catch (error) {
    if (error instanceof BillContextAuthError) return sendError(res, 401, error.message);
    return sendError(res, 503, "Your saved bills could not be securely loaded. Please try again or turn off Bills context.");
  }

  const billContextPrompt = billContext.length
    ? `\n\nNon-identifying summaries from only the currently signed-in user's saved account bills: ${JSON.stringify(billContext)}. Use only to answer relevant questions. If the summaries do not contain the requested detail, say so rather than guessing. These are saved/extracted records, not an official bill.`
    : "";
  const detailedAnswer = asksForDetailedAnswer(messages);
  const responseLengthPrompt = detailedAnswer
    ? "\n\nThe user explicitly requested a detailed answer. Give a thorough but organized explanation, with relevant steps or a short example when useful; do not force it into the normal short-answer limit. Stay focused on the exact question. Format using only Markdown the chat supports: short headings, paragraphs, bullets, and sparing bold. Write formulas as plain text (example: Energy (kWh) = Power (kW) × Time (hours)); do not use LaTeX, backslash math, Markdown tables, code blocks, or horizontal-rule separators."
    : "";

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
        messages: [{ role: "system", content: `${SYSTEM_PROMPT}${billContextPrompt}${responseLengthPrompt}` }, ...messages],
        max_tokens: detailedAnswer ? 900 : 220,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) return sendError(res, 502, "The AI provider could not authorize this request. Please check the server configuration.");
      if (upstream.status === 429) return sendError(res, 503, "The free AI model is busy or rate-limited. Please wait a moment and try again.");
      if (upstream.status === 402) return sendError(res, 503, "The AI provider is temporarily unable to serve this free model. Please try again later.");
      return sendError(res, 502, "The AI provider could not complete this request. Please try again.");
    }

    const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
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
