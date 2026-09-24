import type { BillDraft, BillRecord } from "../types";
import { getSessionId, supabase, supabaseConfigured } from "./supabase";

const LOCAL_KEY = "power-sense-bills";

function localBills(): BillRecord[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as BillRecord[]; } catch { return []; }
}
function saveLocal(bills: BillRecord[]) { localStorage.setItem(LOCAL_KEY, JSON.stringify(bills)); }

export async function listBills(): Promise<BillRecord[]> {
  if (supabaseConfigured && supabase) {
    const { data, error } = await supabase.from("bills").select("*").eq("session_id", getSessionId()).order("billing_date", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as BillRecord[];
  }
  return localBills().filter((bill) => bill.session_id === getSessionId()).sort((a, b) => (a.billing_date || a.created_at).localeCompare(b.billing_date || b.created_at));
}

export async function saveBill(draft: BillDraft, file?: File): Promise<BillRecord> {
  const sessionId = getSessionId();
  let sourceFilePath: string | null = null;
  if (supabaseConfigured && supabase && file) {
    sourceFilePath = `${sessionId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("electricity-bills").upload(sourceFilePath, file, { upsert: false, contentType: file.type });
    if (uploadError) throw new Error(uploadError.message);
  }
  const record: BillRecord = {
    ...draft,
    id: crypto.randomUUID(),
    session_id: sessionId,
    source_file_path: sourceFilePath,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (supabaseConfigured && supabase) {
    const { data, error } = await supabase.from("bills").insert(record).select().single();
    if (error) throw new Error(error.message);
    return data as BillRecord;
  }
  const bills = localBills().filter((bill) => bill.id !== record.id);
  saveLocal([...bills, record]);
  return record;
}

export async function updateBill(id: string, draft: BillDraft): Promise<BillRecord> {
  if (supabaseConfigured && supabase) {
    const { data, error } = await supabase.from("bills").update({ ...draft, updated_at: new Date().toISOString() }).eq("id", id).eq("session_id", getSessionId()).select().single();
    if (error) throw new Error(error.message);
    return data as BillRecord;
  }
  const bills = localBills();
  const index = bills.findIndex((bill) => bill.id === id && bill.session_id === getSessionId());
  if (index < 0) throw new Error("Bill not found");
  bills[index] = { ...bills[index], ...draft, updated_at: new Date().toISOString() };
  saveLocal(bills);
  return bills[index];
}

export async function deleteBill(bill: BillRecord): Promise<void> {
  if (supabaseConfigured && supabase) {
    if (bill.source_file_path) await supabase.storage.from("electricity-bills").remove([bill.source_file_path]);
    const { error } = await supabase.from("bills").delete().eq("id", bill.id).eq("session_id", getSessionId());
    if (error) throw new Error(error.message);
    return;
  }
  saveLocal(localBills().filter((item) => item.id !== bill.id || item.session_id !== getSessionId()));
}

export async function deleteAllBills(): Promise<void> {
  const bills = await listBills();
  if (supabaseConfigured && supabase) {
    const files = bills.map((bill) => bill.source_file_path).filter((path): path is string => Boolean(path));
    if (files.length) await supabase.storage.from("electricity-bills").remove(files);
    const { error } = await supabase.from("bills").delete().eq("session_id", getSessionId());
    if (error) throw new Error(error.message);
    return;
  }
  saveLocal(localBills().filter((item) => item.session_id !== getSessionId()));
}
