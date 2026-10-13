import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL as string | undefined
)?.trim();
const supabaseAnonKey = (
  import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
)?.trim();

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const dataModeLabel = supabaseConfigured
  ? "Supabase Auth · account-scoped"
  : "Supabase configuration required";

export function getSessionId() {
  const key = "power-sense-session-id";
  if (typeof window === "undefined") return "server-session";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}
