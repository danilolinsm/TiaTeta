-- Rode este script inteiro no Supabase: menu lateral "SQL Editor" → "New query" → cole tudo → "Run"
-- Idempotente: pode rodar de novo sem erro. Tabelas usam IF NOT EXISTS e cada policy só é criada
-- se ainda não existir (nunca DROP + CREATE, para não recriar as policies de produção).

create table if not exists children (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  age int not null,
  school text,
  prefs text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  child_id uuid references children(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  subject text not null,
  resumo text,
  resumo_versions jsonb default '[]',
  mapa jsonb default '[]',
  mapa_versions jsonb default '[]',
  mapa_image text,
  questoes jsonb default '[]',
  created_at timestamptz default now()
);

alter table children enable row level security;
alter table activities enable row level security;

-- Cada mãe só consegue ver/criar/editar/apagar os próprios filhos
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'children' and policyname = 'children: only own rows') then
    create policy "children: only own rows" on children
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Cada mãe só consegue ver/criar/editar/apagar as próprias atividades
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'activities: only own rows') then
    create policy "activities: only own rows" on activities
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ===================================================================
-- Permissão para gerar imagens (pôster e ilustração das questões)
-- Por padrão TODOS ficam desabilitados (false). Só o administrador
-- consegue habilitar, através do backend com a service_role key.
-- ===================================================================
create table if not exists permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_generate_images boolean not null default false,
  updated_at timestamptz default now()
);
alter table permissions enable row level security;

-- Cada usuário só pode LER a própria permissão (não pode alterar a própria!)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'permissions' and policyname = 'permissions: self read only') then
    create policy "permissions: self read only" on permissions
      for select using (auth.uid() = user_id);
  end if;
end $$;
-- Sem policy de insert/update/delete para usuários comuns —
-- só o backend com a service_role key consegue escrever aqui.

-- ===================================================================
-- Pedidos de acesso (quando alguém clica em "Solicitar acesso")
-- ===================================================================
create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  requested_at timestamptz default now(),
  status text not null default 'pending'
);
alter table access_requests enable row level security;

-- Cada usuário pode criar e ver os próprios pedidos
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'access_requests' and policyname = 'access_requests: self insert') then
    create policy "access_requests: self insert" on access_requests
      for insert with check (auth.uid() = user_id);
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'access_requests' and policyname = 'access_requests: self read own') then
    create policy "access_requests: self read own" on access_requests
      for select using (auth.uid() = user_id);
  end if;
end $$;
-- Aprovar/negar (update) só pelo backend com a service_role key.

