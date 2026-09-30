-- Rode isso no SQL Editor do Supabase (New query → cole tudo → Run).
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE): pode rodar mais de uma vez, não apaga dados.
--
-- Conferido no schema de produção (catálogos, set/2026):
--   public.usage_monthly JÁ EXISTE: user_id uuid NOT NULL (FK auth.users ON DELETE CASCADE),
--   year_month text NOT NULL, roteiros_count int NOT NULL DEFAULT 0, imagens_count int NOT NULL
--   DEFAULT 0, updated_at timestamptz DEFAULT now(); PRIMARY KEY (user_id, year_month)
--   (usage_monthly_pkey); RLS ligado; policy "usage_monthly: read own rows" (SELECT).
--   NÃO existem: a coluna auxiliares_count e as funções consumir_uso / estornar_uso.
-- O que este arquivo muda em produção: cria auxiliares_count e as duas funções (+ grants).
-- Não cria índice novo: o ON CONFLICT usa a PK existente (usage_monthly_pkey).

-- 1) Tabela: em produção já existe e NÃO é tocada. Só cria em ambiente novo, igual à produção.
create table if not exists public.usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  year_month text not null,
  roteiros_count integer not null default 0,
  imagens_count integer not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, year_month)
);

-- 2) Nova categoria: dicas, verificação de imagem, revisão de texto e questões extras (limite separado)
alter table public.usage_monthly
  add column if not exists auxiliares_count integer not null default 0;

-- 3) RLS (já ligado em produção; no-op) e a policy de leitura da própria linha, só se não existir.
--    Sem policy de INSERT/UPDATE/DELETE: o usuário comum não consegue alterar/zerar o contador.
alter table public.usage_monthly enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'usage_monthly' and policyname = 'usage_monthly: read own rows'
  ) then
    create policy "usage_monthly: read own rows" on public.usage_monthly
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- 4) Checa E incrementa numa única instrução atômica.
--    Devolve o novo valor, ou NULL se o limite já foi atingido (nada é alterado nesse caso).
--    Duas chamadas simultâneas: o ON CONFLICT (PK user_id, year_month) trava a linha; a segunda
--    espera e reavalia o WHERE com o valor já atualizado — então nunca passa do limite.
create or replace function public.consumir_uso(
  p_user_id uuid, p_campo text, p_limite integer, p_year_month text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_novo integer;
begin
  if p_campo not in ('roteiros_count', 'imagens_count', 'auxiliares_count') then
    raise exception 'campo de uso inválido: %', p_campo using errcode = '22023';
  end if;
  if p_year_month is null or p_year_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'year_month inválido: %', p_year_month using errcode = '22023';
  end if;
  if p_limite is null or p_limite <= 0 then
    return null;
  end if;

  execute format(
    'insert into public.usage_monthly as u (user_id, year_month, %1$I, updated_at)
       values ($1, $2, 1, now())
     on conflict (user_id, year_month)
       do update set %1$I = u.%1$I + 1, updated_at = now()
       where u.%1$I < $3
     returning u.%1$I', p_campo)
  into v_novo
  using p_user_id, p_year_month, p_limite;

  return v_novo; -- NULL = limite atingido
end;
$$;

-- 5) Estorno: devolve 1 unidade quando a geração falhou depois da reserva (nunca fica negativo).
create or replace function public.estornar_uso(
  p_user_id uuid, p_campo text, p_year_month text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_novo integer;
begin
  if p_campo not in ('roteiros_count', 'imagens_count', 'auxiliares_count') then
    raise exception 'campo de uso inválido: %', p_campo using errcode = '22023';
  end if;
  execute format(
    'update public.usage_monthly set %1$I = greatest(%1$I - 1, 0), updated_at = now()
      where user_id = $1 and year_month = $2
      returning %1$I', p_campo)
  into v_novo
  using p_user_id, p_year_month;
  return v_novo;
end;
$$;

-- 6) IMPORTANTE (segurança): por padrão o Postgres dá EXECUTE a PUBLIC, e o Supabase expõe funções
--    do schema public na API. Sem estas linhas, qualquer pessoa com a chave anon poderia chamar
--    estornar_uso para zerar o próprio contador, ou consumir_uso para esgotar o limite de outra conta.
revoke all on function public.consumir_uso(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.estornar_uso(uuid, text, text) from public, anon, authenticated;
grant execute on function public.consumir_uso(uuid, text, integer, text) to service_role;
grant execute on function public.estornar_uso(uuid, text, text) to service_role;

-- 7) Faz a API (PostgREST) enxergar as funções novas na hora.
notify pgrst, 'reload schema';

-- Nota (incerto, não verificado nos catálogos): o Supabase costuma ter "default privileges" que
-- dão EXECUTE em funções novas para anon/authenticated. O REVOKE acima roda DEPOIS do CREATE,
-- então remove esse grant de qualquer forma. Para conferir depois de rodar:
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_schema = 'public' and routine_name in ('consumir_uso', 'estornar_uso');
--   (esperado: só service_role e o dono da função, normalmente postgres)
