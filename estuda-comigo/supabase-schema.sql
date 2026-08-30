-- Rode este script inteiro no Supabase: menu lateral "SQL Editor" → "New query" → cole tudo → "Run"

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
create policy "children: only own rows" on children
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Cada mãe só consegue ver/criar/editar/apagar as próprias atividades
create policy "activities: only own rows" on activities
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
