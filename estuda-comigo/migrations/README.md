# Migrações do banco (Supabase)

Rode esses arquivos **na ordem numérica**, um de cada vez, no SQL Editor do Supabase
(Supabase → SQL Editor → New query → colar o conteúdo do arquivo → Run).

Se você já rodou algum deles antes (mesmo com o nome antigo), **não precisa rodar de novo** —
o conteúdo é o mesmo, só o nome do arquivo mudou pra ficar mais fácil de organizar.

| Ordem | Arquivo | O que cria |
|---|---|---|
| 1 | `001_schema_inicial.sql` | Tabelas base: `children` (filhos) e `activities` (roteiros de estudo) |
| 2 | `002_permissoes_geracao_imagem.sql` | Controle de quem pode gerar imagens (`permissions`) e pedidos de acesso (`access_requests`) |
| 3 | `003_simulado_tentativas.sql` | Data da prova por atividade e histórico de tentativas do simulado (`attempts`) |
| 4 | `004_provas.sql` | Entidade própria de "prova" (`exams`), permitindo vincular vários roteiros de estudo à mesma prova |

Quando adicionarmos mudanças novas no banco no futuro, o próximo arquivo deve se chamar
`005_alguma-coisa.sql`, seguindo a mesma numeração.
