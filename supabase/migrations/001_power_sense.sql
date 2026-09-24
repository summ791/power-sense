-- Power Sense: database and storage setup
create extension if not exists pgcrypto;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
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
  source_file_path text,
  ocr_confidence numeric check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bills_session_id_idx on public.bills(session_id);
create index if not exists bills_billing_date_idx on public.bills(billing_date);
create index if not exists bills_consumer_number_idx on public.bills(consumer_number);

alter table public.bills enable row level security;

create or replace function public.power_sense_session_id()
returns text
language sql
stable
as $$
  select coalesce((current_setting('request.headers', true)::json ->> 'x-session-id'), '');
$$;

drop policy if exists "session can read own bills" on public.bills;
drop policy if exists "session can insert own bills" on public.bills;
drop policy if exists "session can update own bills" on public.bills;
drop policy if exists "session can delete own bills" on public.bills;

create policy "session can read own bills" on public.bills for select to anon, authenticated using (session_id = public.power_sense_session_id());
create policy "session can insert own bills" on public.bills for insert to anon, authenticated with check (session_id = public.power_sense_session_id());
create policy "session can update own bills" on public.bills for update to anon, authenticated using (session_id = public.power_sense_session_id()) with check (session_id = public.power_sense_session_id());
create policy "session can delete own bills" on public.bills for delete to anon, authenticated using (session_id = public.power_sense_session_id());

insert into storage.buckets (id, name, public)
values ('electricity-bills', 'electricity-bills', false)
on conflict (id) do update set public = false;

drop policy if exists "session can upload bill files" on storage.objects;
drop policy if exists "session can read bill files" on storage.objects;
drop policy if exists "session can delete bill files" on storage.objects;

create policy "session can upload bill files" on storage.objects for insert to anon, authenticated with check (
  bucket_id = 'electricity-bills' and (storage.foldername(name))[1] = public.power_sense_session_id()
);
create policy "session can read bill files" on storage.objects for select to anon, authenticated using (
  bucket_id = 'electricity-bills' and (storage.foldername(name))[1] = public.power_sense_session_id()
);
create policy "session can delete bill files" on storage.objects for delete to anon, authenticated using (
  bucket_id = 'electricity-bills' and (storage.foldername(name))[1] = public.power_sense_session_id()
);
