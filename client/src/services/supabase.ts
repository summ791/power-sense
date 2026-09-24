import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SESSION_KEY = "power-sense-session-id";

export function getSessionId(): string {
  const current = localStorage.getItem(SESSION_KEY);
  if (current) return current;
  const next = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      global: { headers: { "x-session-id": getSessionId() } },
    })
  : null;

export const dataModeLabel = supabaseConfigured ? "Connected to Supabase" : "Local preview mode";
