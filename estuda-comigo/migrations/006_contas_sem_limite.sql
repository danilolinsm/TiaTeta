-- Rode isso no SQL Editor do Supabase (New query → cole tudo → Run).
-- Idempotente: pode rodar mais de uma vez.
--
-- Conta "sem limite de uso" (toggle 🚀 no painel admin, gravado por api/admin-permissions.js).
-- Admins (ADMIN_EMAILS) já são ilimitados pelo código, sem precisar desta coluna.
--
-- Conferido no schema de produção (catálogos, set/2026): permissions.unlimited JÁ EXISTE como
-- boolean NOT NULL DEFAULT false. Em produção este arquivo não muda nada; ele existe para
-- registrar a coluna no repositório e recriar ambientes novos iguais à produção.
alter table public.permissions
  add column if not exists unlimited boolean not null default false;

-- Sem policy nova: a "permissions: self read only" (SELECT, auth.uid() = user_id), que já existe
-- em produção, continua valendo. O usuário só LÊ a própria linha e não consegue se marcar como
-- ilimitado. Só o backend (service_role) escreve.
