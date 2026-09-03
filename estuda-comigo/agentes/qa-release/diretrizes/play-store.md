# Diretrizes Google Play — resumo para a Fase 2

Conteúdo estável, entra no cache de prompt junto com o de App Store. Revise a
cada trimestre contra:
https://support.google.com/googleplay/android-developer/answer/10787469

## Data safety — a seção que bloqueia submissão se estiver incompleta

O Play Console não deixa submeter sem esse formulário preenchido. Ele cobre 14
categorias de dado e pergunta, para cada uma: é coletado, é compartilhado, com
qual propósito, é opcional, é criptografado em trânsito, é deletável.

Regras que mudam o que conta como "coletar" ou "compartilhar", e que
costumam pegar app pequeno de surpresa:

- Se o app lê Android ID (`Settings.Secure.ANDROID_ID`) por qualquer motivo,
  isso precisa ser declarado em "Device or other IDs" — sem exceção.
- "Compartilhar" inclui qualquer SDK de terceiro que usa o dado do seu app
  para propósito próprio dele — mesmo que seja só para benchmark agregado do
  provedor. Se você usa um SDK de analytics ou crash report, verifique a
  política dele antes de marcar "não compartilha".
- A resposta no formulário precisa bater três vezes: com a política de
  privacidade, com o que o binário realmente faz, e com a página de exclusão
  de conta (se o app tem conta de usuário, precisa ter jeito de deletar a
  conta e os dados associados — e isso precisa estar acessível, não escondido).
- Divergência entre essas três fontes é o principal motivo de flag automática
  na revisão atual do Play — o Google já roda checagem automatizada no binário
  antes da revisão humana.

## Classificação de conteúdo (IARC)

Questionário único gera classificação para várias regiões de uma vez. Responda
pensando no conteúdo real do app, não no que soa melhor pra loja — divergência
entre classificação declarada e conteúdo real pode gerar remoção.

## Contas e exclusão

Se o Tia Teta tem sistema de conta (login, progresso salvo), o Play exige
caminho para o usuário deletar a conta e os dados de dentro do próprio app —
não só por e-mail para o suporte. Confirme que esse fluxo existe e funciona
antes de qualquer submissão.

## Metadados

Mesma regra da App Store: sem alegação de eficácia não comprovável no título,
descrição curta ou descrição completa. "Prepare-se para o ENEM com questões
organizadas por habilidade" é afirmação de recurso. "Garanta sua aprovação" é
alegação de resultado — evite.

---
Isto é um resumo de apoio, não orientação jurídica nem substituto da página
oficial. Políticas do Play mudam com frequência — reconfira antes de cada
submissão, principalmente a seção de Data safety.
