# Migrações do banco (Supabase)

Rode esses arquivos **na ordem numérica**, um de cada vez, no SQL Editor do Supabase
(Supabase → SQL Editor → New query → colar o conteúdo do arquivo → Run).

Se você já rodou algum deles antes (mesmo com o nome antigo), **não precisa rodar de novo** —
o conteúdo é o mesmo, só o nome do arquivo mudou pra ficar mais fácil de organizar.
A partir da 006 os arquivos são idempotentes (`IF NOT EXISTS` / `CREATE OR REPLACE`): rodar de novo não estraga nada.

| Ordem | Arquivo | O que cria |
|---|---|---|
| 1 | `001_schema_inicial.sql` | Tabelas base: `children` (filhos) e `activities` (roteiros de estudo), com RLS "só as próprias linhas" |
| 2 | `002_permissoes_geracao_imagem.sql` | Controle de quem pode gerar imagens (`permissions`) e pedidos de acesso (`access_requests`) |
| 3 | `003_simulado_tentativas.sql` | Data da prova por atividade e histórico de tentativas do simulado (`attempts`) |
| 4 | `004_provas.sql` | Entidade própria de "prova" (`exams`), permitindo vincular vários roteiros de estudo à mesma prova |
| 5 | `005_observacoes_prova.sql` | Campo de observações (`notes`) na prova |
| 6 | `006_contas_sem_limite.sql` | Coluna `unlimited` em `permissions` (toggle 🚀 "Sem limite de uso" do painel admin) — ⚠️ rascunho, confirmar com o schema real |
| 7 | `007_uso_mensal_limites_rpc.sql` | Tabela `usage_monthly` (se não existir) + coluna `auxiliares_count` + funções atômicas `consumir_uso`/`estornar_uso` (só o backend pode chamar) + RLS — ⚠️ rascunho, confirmar com o schema real |

## Ordem segura de deploy (006/007 + código dos limites)

O código de `lib/usage.js` funciona **antes e depois** das migrations:

- sem a função `consumir_uso` (erro `PGRST202`/`42883`), ele volta ao caminho antigo (ler e gravar, não atômico) e escreve um aviso no log da Vercel;
- sem a coluna `auxiliares_count`, os usos de apoio (dicas, revisão de texto etc.) passam sem contagem, igual à produção de hoje; roteiros e imagens continuam limitados;
- sem a coluna `unlimited`, só os admins (`ADMIN_EMAILS`) ficam sem limite.

Ordem recomendada:
1. Conferir o schema real (ver o cabeçalho "A CONFIRMAR" de cada arquivo) e ajustar se preciso.
2. Rodar a `006` e depois a `007` no SQL Editor.
3. Fazer o deploy do código (merge do PR). Se o código subir antes, tudo continua funcionando pelo caminho antigo até as migrations serem aplicadas.
4. Conferir nos logs da Vercel que **não** aparecem mais avisos `[usage] ... aplique a migration`.

Quando adicionarmos mudanças novas no banco no futuro, o próximo arquivo deve se chamar
`008_alguma-coisa.sql`, seguindo a mesma numeração.
