-- Rode isso no SQL Editor do Supabase (New query → cole tudo → Run).

-- Data da prova (opcional) em cada atividade
alter table activities add column if not exists exam_date date;

-- Histórico de tentativas do simulado (cada vez que a criança responde e corrige)
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete cascade not null,
  child_id uuid references children(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  subject text not null,
  total_questions int not null,
  correct_count int not null,
  wrong_questions jsonb default '[]',
  answered_at timestamptz default now()
);
alter table attempts enable row level security;
create policy "attempts: only own rows" on attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
