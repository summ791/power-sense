-- Power Sense: session-scoped bill data and private source documents.
-- The browser stores only a random UUID and sends it as x-session-id; the UUID
-- is used as a high-entropy bearer capability for database and object access.
create extension if not exists pgcrypto;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  session_id text not null check (session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  consumer_number text,
  customer_name text,
  provider text,
  meter_number text,
  billing_date date,
  billing_period text,
  due_date date,
  previous_reading numeric,
  current_reading numeric,
  units_consumed numeric,
  energy_charge numeric,
  fixed_charge numeric,
  tax numeric,
  other_charge numeric,
  total_amount numeric,
  tariff_data jsonb not null default '{}'::jsonb,
  ocr_confidence jsonb not null default '{}'::jsonb,
  source_file_path text check (
    source_file_path is null or split_part(source_file_path, '/', 1) = session_id
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bills_session_id_idx on public.bills(session_id);
create index if not exists bills_billing_date_idx on public.bills(billing_date);
create index if not exists bills_consumer_number_idx on public.bills(consumer_number);

create or replace function public.power_sense_session_id()
returns text
language sql
stable
set search_path = ''
as $function$
  select nullif(current_setting('request.headers', true)::jsonb ->> 'x-session-id', '');
$function$;

create or replace function public.power_sense_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists bills_set_updated_at on public.bills;
create trigger bills_set_updated_at
before update on public.bills
for each row execute function public.power_sense_set_updated_at();

alter table public.bills enable row level security;

drop policy if exists "session can read own bills" on public.bills;
drop policy if exists "session can insert own bills" on public.bills;
drop policy if exists "session can update own bills" on public.bills;
drop policy if exists "session can delete own bills" on public.bills;

create policy "session can read own bills"
on public.bills for select to anon, authenticated
using (session_id = (select public.power_sense_session_id()));

create policy "session can insert own bills"
on public.bills for insert to anon, authenticated
with check (session_id = (select public.power_sense_session_id()));

create policy "session can update own bills"
on public.bills for update to anon, authenticated
using (session_id = (select public.power_sense_session_id()))
with check (session_id = (select public.power_sense_session_id()));

create policy "session can delete own bills"
on public.bills for delete to anon, authenticated
using (session_id = (select public.power_sense_session_id()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'electricity-bills',
  'electricity-bills',
  false,
  15728640,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "session can upload bill files" on storage.objects;
drop policy if exists "session can read bill files" on storage.objects;
drop policy if exists "session can delete bill files" on storage.objects;

create policy "session can upload bill files"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'electricity-bills'
  and (storage.foldername(name))[1] = (select public.power_sense_session_id())
);

create policy "session can read bill files"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'electricity-bills'
  and (storage.foldername(name))[1] = (select public.power_sense_session_id())
);

create policy "session can delete bill files"
on storage.objects for delete to anon, authenticated
using (
  bucket_id = 'electricity-bills'
  and (storage.foldername(name))[1] = (select public.power_sense_session_id())
);
