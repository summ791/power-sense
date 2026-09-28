import type { BillDraft, BillRecord } from "../types";
import { supabase, supabaseConfigured } from "./supabase";

export type TariffData = {
  category?: string | null;
  description?: string | null;
};

export function serializeBillDraft(
  draft: BillDraft,
  userId: string,
  sourceFilePath: string | null,
  id: string = crypto.randomUUID(),
  timestamp = new Date().toISOString()
) {
  return {
    id,
    user_id: userId,
    consumer_number: draft.consumer_number || null,
    customer_name: draft.customer_name || null,
    provider: draft.provider || null,
    meter_number: draft.meter_number || null,
    billing_date: draft.billing_date || null,
    billing_period: draft.billing_period || null,
    due_date: draft.due_date || null,
    previous_reading: draft.previous_reading,
    current_reading: draft.current_reading,
    units_consumed: draft.units_consumed,
    energy_charge: draft.energy_charge,
    fixed_charge: draft.fixed_charge,
    tax: draft.tax,
    other_charge: draft.other_charge,
    total_amount: draft.total_amount,
    tariff_data: {
      category: draft.tariff || null,
      description: draft.tariff_description || null,
    } satisfies TariffData,
    ocr_confidence: { score: Math.max(0, Math.min(1, draft.ocr_confidence)) },
    source_file_path: sourceFilePath,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function deserializeBillRecord(
  row: Record<string, unknown>
): BillRecord {
  const tariffData =
    row.tariff_data && typeof row.tariff_data === "object"
      ? (row.tariff_data as TariffData)
      : {};
  const confidenceData =
    row.ocr_confidence && typeof row.ocr_confidence === "object"
      ? (row.ocr_confidence as { score?: unknown })
      : {};
  const confidence =
    typeof row.ocr_confidence === "number"
      ? row.ocr_confidence
      : Number(confidenceData.score ?? 0);
  const numberOrNull = (value: unknown) =>
    value === null || value === undefined ? null : Number(value);
  const stringOrEmpty = (value: unknown) =>
    value === null || value === undefined ? "" : String(value);

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    consumer_number: stringOrEmpty(row.consumer_number),
    customer_name: stringOrEmpty(row.customer_name),
    provider: stringOrEmpty(row.provider),
    meter_number: stringOrEmpty(row.meter_number),
    billing_date: stringOrEmpty(row.billing_date),
    billing_period: stringOrEmpty(row.billing_period),
    due_date: stringOrEmpty(row.due_date),
    previous_reading: numberOrNull(row.previous_reading),
    current_reading: numberOrNull(row.current_reading),
    units_consumed: numberOrNull(row.units_consumed),
    energy_charge: numberOrNull(row.energy_charge),
    fixed_charge: numberOrNull(row.fixed_charge),
    tax: numberOrNull(row.tax),
    other_charge: numberOrNull(row.other_charge),
    total_amount: numberOrNull(row.total_amount),
    tariff: String(tariffData.category ?? ""),
    tariff_description: String(tariffData.description ?? ""),
    ocr_confidence: Number.isFinite(confidence) ? confidence : 0,
    source_file_path: row.source_file_path
      ? String(row.source_file_path)
      : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function requireSupabase() {
  if (!supabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Bill data was not saved. Please contact the site administrator."
    );
  }
  return supabase;
}

async function requireAuthenticatedClient() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Error("Please sign in to access your saved bills.");
  }
  return { client, user: data.user };
}

function mimeType(file: File): string {
  if (file.type === "image/jpg") return "image/jpeg";
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  return "image/jpeg";
}

function assertOwnedPath(path: string, userId: string) {
  if (!path.startsWith(`${userId}/`)) {
    throw new Error(
      "This source file does not belong to the signed-in account."
    );
  }
}

export async function listBills(): Promise<BillRecord[]> {
  const { client, user } = await requireAuthenticatedClient();
  const { data, error } = await client
    .from("bills")
    .select("*")
    .eq("user_id", user.id)
    .order("billing_date", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(row =>
    deserializeBillRecord(row as Record<string, unknown>)
  );
}

export async function saveBill(
  draft: BillDraft,
  file?: File
): Promise<BillRecord> {
  const { client, user } = await requireAuthenticatedClient();
  const id = crypto.randomUUID();
  let sourceFilePath: string | null = null;

  if (file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    sourceFilePath = `${user.id}/${id}-${safeName}`;
    const { error } = await client.storage
      .from("electricity-bills")
      .upload(sourceFilePath, file, {
        upsert: false,
        contentType: mimeType(file),
      });
    if (error) throw new Error(`Original bill upload failed: ${error.message}`);
  }

  const record = serializeBillDraft(draft, user.id, sourceFilePath, id);
  const { data, error } = await client
    .from("bills")
    .insert(record)
    .select("*")
    .single();
  if (error) {
    if (sourceFilePath) {
      await client.storage.from("electricity-bills").remove([sourceFilePath]);
    }
    throw new Error(error.message);
  }
  return deserializeBillRecord(data as Record<string, unknown>);
}

export async function updateBill(
  id: string,
  draft: BillDraft
): Promise<BillRecord> {
  const { client, user } = await requireAuthenticatedClient();
  const serialized = serializeBillDraft(draft, user.id, null, id);
  const {
    id: _id,
    user_id: _userId,
    source_file_path: _path,
    created_at: _createdAt,
    ...fields
  } = serialized;
  const { data, error } = await client
    .from("bills")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return deserializeBillRecord(data as Record<string, unknown>);
}

export async function getSourceFileUrl(path: string): Promise<string> {
  const { client, user } = await requireAuthenticatedClient();
  assertOwnedPath(path, user.id);
  const { data, error } = await client.storage
    .from("electricity-bills")
    .createSignedUrl(path, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function deleteBill(bill: BillRecord): Promise<void> {
  const { client, user } = await requireAuthenticatedClient();
  if (bill.user_id !== user.id) {
    throw new Error("This bill does not belong to the signed-in account.");
  }
  if (bill.source_file_path) {
    assertOwnedPath(bill.source_file_path, user.id);
  }
  const { data, error } = await client
    .from("bills")
    .delete()
    .eq("id", bill.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Bill not found in this account.");

  if (bill.source_file_path) {
    const { error: storageError } = await client.storage
      .from("electricity-bills")
      .remove([bill.source_file_path]);
    if (storageError)
      throw new Error(
        `Bill record was deleted, but its source file could not be removed: ${storageError.message}`
      );
  }
}

export async function deleteAllBills(): Promise<void> {
  const { client, user } = await requireAuthenticatedClient();
  const bills = await listBills();
  const paths = bills
    .map(bill => bill.source_file_path)
    .filter((path): path is string => Boolean(path));
  paths.forEach(path => assertOwnedPath(path, user.id));

  const { error } = await client.from("bills").delete().eq("user_id", user.id);
  if (error) throw new Error(error.message);

  if (paths.length) {
    const { error: storageError } = await client.storage
      .from("electricity-bills")
      .remove(paths);
    if (storageError)
      throw new Error(
        `Bills were deleted, but some source files could not be removed: ${storageError.message}`
      );
  }
}
