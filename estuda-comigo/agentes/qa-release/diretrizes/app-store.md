# Diretrizes App Store — resumo para a Fase 2

Este arquivo é o que a Fase 2 (Sonnet) lê para checar conformidade. Mantenha
estável — é justamente por não mudar toda hora que ele entra no cache de
prompt e sai barato. Revise a cada trimestre contra a página oficial:
https://developer.apple.com/app-store/review/guidelines/

## Classificação etária (atualizada em 2026)

O sistema mudou: além de 4+ e 9+, agora existem 13+, 16+ e 18+. A classificação
é calculada por um questionário em App Store Connect e pode variar por país.

- Não existe mais "escolher a classificação que parece certa" — é calculada.
  Responda o questionário com honestidade, não com o resultado que você quer.
- Categoria "Made for Kids" é irreversível depois de aprovada. Se o app não é
  feito para crianças pequenas, não marque essa opção — o Tia Teta tem público
  adolescente, não infantil, então isso normalmente fica desmarcado.
- Se o app tiver algum recurso de IA/chatbot, o questionário pergunta sobre
  frequência de conteúdo sensível que esse recurso pode gerar. Responda pra
  esse recurso, não só para o conteúdo estático do app.

## Privacidade — o ponto mais sensível para este app

Público majoritariamente entre 15 e 18 anos. Nem sempre menor de 13 (o que
mudaria as regras de COPPA), mas ainda assim menor de idade na maior parte dos
casos.

- Política de privacidade completa e acessível: precisa estar linkada tanto em
  App Store Connect quanto dentro do app (normalmente nas configurações).
- Formulário de App Privacy em App Store Connect precisa declarar TODO tipo de
  dado coletado e se é vinculado ao usuário ou usado para tracking. Isso tem
  que bater com o `store-metadata.json` e com o que o app realmente faz.
- Se em algum momento o app coletar dado de usuário comprovadamente menor de
  13 anos, COPPA entra em jogo: consentimento parental verificável antes de
  coletar dado pessoal, parental gate para compras e links externos, e cuidado
  com SDKs de terceiros que coletam PII de menores.
- Evite qualquer SDK de analytics de terceiro que colete identificador
  pessoal de usuário sem necessidade clara.

## Suporte

App educacional precisa de canal de contato fácil de achar — o Support URL é
obrigatório e revisores checam isso especificamente para apps "que podem ser
usados em sala de aula".

## Metadados e alegações

- Sem alegação de resultado ou eficácia não comprovável: nada de "garanta sua
  aprovação" ou "aumente sua nota em X pontos". Descreva o que o app faz
  (organiza conteúdo, simula prova, mostra estimativa de TRI), não uma
  promessa de resultado do usuário.
- Screenshot sem texto ilegível, sem simulação de UI de sistema operacional
  que não seja real, sem comparação direta com concorrentes nomeados.
- Changelog escrito para o usuário final ler, não um log de commits.

## In-app purchase

Se o app vender qualquer conteúdo consumido dentro do app (assinatura, pacote
de questões, etc.), o pagamento precisa passar pelo sistema de In-App Purchase
da Apple. Pagamento externo para conteúdo consumido no app é motivo de rejeição
direta — não tem meio-termo aqui.

## Nota internacional

A partir de junho de 2026, contas Apple criadas no Texas (EUA) exigem age
assurance e consentimento parental para menores de 18 — específico dos EUA,
mas serve de sinal de que o assunto "verificação de idade" está mais rígido
globalmente. Não ignore esse tema achando que "não se aplica ao Brasil hoje" —
reconfira antes de cada submissão.

---
Este documento é um resumo de apoio, não substitui a leitura da página oficial
de diretrizes antes de cada submissão. Políticas mudam sem aviso.
