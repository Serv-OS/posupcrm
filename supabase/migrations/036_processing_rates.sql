-- Per-category processing rates: scheme (Visa/Mastercard, Amex) × presentment
-- (card present / card not present). Percentages per category; per-transaction
-- fees stay at account level. Volume/revenue remain account-level (monthly).
create table if not exists public.processing_rates (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.processing_accounts(id) on delete cascade,
  category         text not null check (category in ('visa_mc_cp','visa_mc_cnp','amex_cp','amex_cnp')),
  current_rate_pct numeric,   -- what they pay now
  our_rate_pct     numeric,   -- what we charge
  buy_rate_pct     numeric,   -- our cost
  created_at       timestamptz not null default now(),
  unique (account_id, category)
);
create index if not exists idx_processing_rates_account on public.processing_rates(account_id);

alter table public.processing_rates enable row level security;
drop policy if exists processing_rates_read on public.processing_rates;
create policy processing_rates_read on public.processing_rates for select using (auth.uid() is not null);
drop policy if exists processing_rates_write on public.processing_rates;
create policy processing_rates_write on public.processing_rates for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','editor')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','editor')));
