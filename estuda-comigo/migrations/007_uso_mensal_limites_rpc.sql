-- ===================================================================================
-- ⚠️ A CONFIRMAR COM O SCHEMA REAL
-- Rascunho escrito sem acesso ao banco de produção (o conector do Supabase não estava
-- disponível). A tabela usage_monthly JÁ É USADA em produção por lib/usage.js, mas não
-- tinha migration no repo. Colunas inferidas do código:
--   user_id (uuid), year_month (text 'AAAA-MM', mês em UTC), roteiros_count (int),
--   imagens_count (int), com unicidade em (user_id, year_month) — o código faz
--   upsert com on_conflict=user_id,year_month, então essa unicidade já deve existir.
-- Antes de rodar, confira no Supabase (Table Editor → usage_monthly, e Database → Indexes):
--   * tipos das colunas (se year_month for `date` em vez de text, AJUSTE as funções abaixo);
--   * se já existe PK/unique em (user_id, year_month);
--   * se o RLS da tabela está ligado (ver observação de segurança no fim).
-- Tudo aqui é idempotente (IF NOT EXISTS / CREATE OR REPLACE): rodar em produção não apaga dados.
-- ===================================================================================
-- Rode isso no SQL Editor do Supabase (New query → cole tudo → Run).

-- 1) Tabela de uso mensal (só cria se ainda não existir)
create table if not exists public.usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  year_month text not null,
  roteiros_count integer not null default 0,
  imagens_count integer not null default 0,
  primary key (user_id, year_month)
);

-- 2) Colunas (se a tabela já existia, garante as antigas e cria a nova categoria)
alter table public.usage_monthly add column if not exists roteiros_count integer not null default 0;
alter table public.usage_monthly add column if not exists imagens_count integer not null default 0;
-- novo: dicas, verificação de imagem, revisão de texto e questões extras (limite separado)
alter table public.usage_monthly add column if not exists auxiliares_count integer not null default 0;

-- 3) Unicidade exigida pelo ON CONFLICT. Se a tabela já tem PK em (user_id, year_month), este
--    índice é redundante mas inofensivo. Se falhar por duplicatas, há linhas repetidas para o
--    mesmo usuário/mês: some os valores numa linha só e apague as outras antes de rodar de novo.
create unique index if not exists usage_monthly_user_mes_uidx
  on public.usage_monthly (user_id, year_month);

-- 4) RLS: ninguém além do backend (service_role, que ignora RLS) precisa ler/escrever aqui.
--    Sem policy = usuário comum não lê nem altera (impede alguém "zerar" o próprio contador
--    usando a chave anon pública).
alter table public.usage_monthly enable row level security;

-- 5) Checa E incrementa numa única instrução atômica.
--    Devolve o novo valor, ou NULL se o limite já foi atingido (nada é alterado nesse caso).
--    Duas chamadas simultâneas: o ON CONFLICT trava a linha, a segunda espera e reavalia o WHERE
--    com o valor já atualizado — então nunca passa do limite.
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
    'insert into public.usage_monthly as u (user_id, year_month, %1$I)
       values ($1, $2, 1)
     on conflict (user_id, year_month)
       do update set %1$I = u.%1$I + 1
       where u.%1$I < $3
     returning u.%1$I', p_campo)
  into v_novo
  using p_user_id, p_year_month, p_limite;

  return v_novo; -- NULL = limite atingido
end;
$$;

-- 6) Estorno: devolve 1 unidade quando a geração falhou depois da reserva (nunca fica negativo).
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
    'update public.usage_monthly set %1$I = greatest(%1$I - 1, 0)
      where user_id = $1 and year_month = $2
      returning %1$I', p_campo)
  into v_novo
  using p_user_id, p_year_month;
  return v_novo;
end;
$$;

-- 7) IMPORTANTE (segurança): por padrão o Postgres dá EXECUTE a PUBLIC, e o Supabase expõe
--    funções do schema public na API. Sem estas linhas, qualquer pessoa com a chave anon poderia
--    chamar estornar_uso para zerar o próprio contador, ou consumir_uso para esgotar o limite de outra conta.
revoke all on function public.consumir_uso(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.estornar_uso(uuid, text, text) from public, anon, authenticated;
grant execute on function public.consumir_uso(uuid, text, integer, text) to service_role;
grant execute on function public.estornar_uso(uuid, text, text) to service_role;

-- 8) Faz a API (PostgREST) enxergar as funções novas na hora.
notify pgrst, 'reload schema';
