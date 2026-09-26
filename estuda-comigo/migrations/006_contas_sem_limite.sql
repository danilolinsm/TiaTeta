-- ===================================================================================
-- ⚠️ A CONFIRMAR COM O SCHEMA REAL
-- Rascunho escrito sem acesso ao banco de produção (o conector do Supabase não estava
-- disponível). Inferido de api/admin-permissions.js (grava `unlimited` em permissions)
-- e do painel admin em public/index.html. Antes de rodar, confira no Supabase:
--   Table Editor → permissions → a coluna `unlimited` já existe? Qual o tipo/default?
-- Se já existir igual (boolean, default false), rodar este arquivo não muda nada.
-- ===================================================================================
-- Rode isso no SQL Editor do Supabase (New query → cole tudo → Run).
-- Idempotente: pode rodar mais de uma vez.

-- Conta "sem limite de uso" (toggle 🚀 no painel admin). Admins (ADMIN_EMAILS) já são
-- ilimitados pelo código, sem precisar desta coluna.
alter table public.permissions
  add column if not exists unlimited boolean not null default false;

-- A policy "permissions: self read only" (migration 002) continua valendo: o usuário só LÊ
-- a própria linha e não consegue se marcar como ilimitado. Só o backend (service_role) escreve.
