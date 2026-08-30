-- Rode isso no SQL Editor do Supabase (New query → cole tudo → Run).

create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  child_id uuid references children(id) on delete cascade not null,
  subject text not null,
  exam_date date,
  created_at timestamptz default now()
);
alter table exams enable row level security;
create policy "exams: only own rows" on exams
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Cada roteiro de estudo pode (opcionalmente) estar vinculado a uma prova
alter table activities add column if not exists exam_id uuid references exams(id) on delete set null;

-- Cada tentativa de simulado também guarda o vínculo direto, pra somar os resultados fácil
alter table attempts add column if not exists exam_id uuid references exams(id) on delete set null;
