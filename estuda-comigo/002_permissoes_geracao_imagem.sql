-- Rode isso no SQL Editor do Supabase (New query → cole tudo → Run).
-- Use este arquivo se você JÁ rodou o supabase-schema.sql antes —
-- ele só adiciona as tabelas novas de permissão, sem repetir o resto.

create table if not exists permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_generate_images boolean not null default false,
  updated_at timestamptz default now()
);
alter table permissions enable row level security;
create policy "permissions: self read only" on permissions
  for select using (auth.uid() = user_id);

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  requested_at timestamptz default now(),
  status text not null default 'pending'
);
alter table access_requests enable row level security;
create policy "access_requests: self insert" on access_requests
  for insert with check (auth.uid() = user_id);
create policy "access_requests: self read own" on access_requests
  for select using (auth.uid() = user_id);
