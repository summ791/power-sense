import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SESSION_KEY = "power_sense_session_id";
const LEGACY_SESSION_KEY = "power-sense-session-id";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getSessionId(): string {
  if (typeof window === "undefined") return "";

  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && UUID_PATTERN.test(existing)) return existing;

    const legacy = localStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy && UUID_PATTERN.test(legacy)) {
      localStorage.setItem(SESSION_KEY, legacy);
      localStorage.removeItem(LEGACY_SESSION_KEY);
      return legacy;
    }

    const sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return sessionId;
  } catch {
    // Storage can be unavailable in a restricted browser. The generated UUID
    // still allows this page session to operate, but will not survive refresh.
    return crypto.randomUUID();
  }
}

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL as string | undefined
)?.trim();
const supabaseAnonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
)?.trim();

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      global: { headers: { "x-session-id": getSessionId() } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

export const dataModeLabel = supabaseConfigured
  ? "Supabase · session-scoped"
  : "Supabase configuration required";
