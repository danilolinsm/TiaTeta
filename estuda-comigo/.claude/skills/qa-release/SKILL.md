---
name: qa-release-tia-teta
description: Prepara um release do app Tia Teta para submissão manual na App Store, Google Play e web. Roda a bateria de verificação, triagem de falhas, checagem de conformidade das lojas e monta o pacote de submissão. Use quando houver um candidato a release, quando o usuário pedir "preparar release", "montar build", "checklist de submissão", ou antes de qualquer publicação. NÃO submete nada — apenas entrega o pacote pronto e um checklist para aprovação humana.
---

# QA e release — Tia Teta

## O que este agente faz e o que ele nunca faz

Faz: valida o candidato a release, identifica o que está quebrado, escreve os
textos e metadados das lojas, monta a pasta de submissão e abre uma issue de
checklist.

Nunca faz: submeter para App Store ou Play, assinar build, subir para produção,
alterar versão sem aprovação, mexer em chaves ou credenciais. A submissão é do
Danilo. O agente entrega o pacote e para.

## Princípio de custo

A regra é uma só: **modelo barato onde errar é barato de corrigir, modelo bom
onde errar custa tempo de terceiros.**

Uma rejeição de loja custa 24–72h de espera até a próxima revisão. Uma chamada
de LLM custa centavos. Portanto a fase de conformidade nunca economiza modelo.
Já classificar 40 falhas de teste é volume alto, verificável na hora e de raio
curto — se errar, o passo seguinte pega. Essa é a fase que economiza.

Antes de chamar qualquer modelo, pergunte: isso é determinístico? Se um script
resolve, o script resolve. Nenhum modelo deve ser chamado para contar arquivos,
medir bundle, rodar teste ou comparar strings.

## Pipeline

### Fase 0 — Pré-voo (custo zero, sem LLM)

Rode `preflight.sh`. Ele cobre lint, typecheck, suíte de testes, build de
produção, tamanho do bundle, auditoria de dependências e captura de screenshots.

Se o pré-voo falhar por erro de build ou compilação, **pare aqui**. Não gaste
token analisando um projeto que não compila. Abra a issue com a saída bruta do
erro e encerre a execução.

Só siga para a Fase 1 se o pré-voo tiver rodado até o fim, com ou sem falhas de
teste.

### Fase 1 — Triagem de falhas (Haiku)

Para cada teste que falhou, classifique em uma de quatro categorias:
`regressao_real`, `flake`, `teste_desatualizado`, `indeterminado`.

Uma falha por chamada, em lote. Entregue JSON estrito, sem prosa:

```json
{"teste": "...", "categoria": "...", "confianca": 0.0-1.0, "motivo": "uma frase"}
```

Regra de escalonamento: qualquer item com `confianca < 0.7` ou categoria
`indeterminado` sobe para Sonnet na Fase 2. Não tente resolver na base — um
`flake` marcado errado como `regressao_real` custa uma investigação inútil do
Danilo, e isso é exatamente o retrabalho que a economia deveria evitar.

Se mais de 30% dos itens escalarem, o prompt está ruim. Registre isso na issue
em vez de seguir empurrando volume para o modelo maior.

### Fase 2 — Conformidade e textos das lojas (Sonnet)

Aqui não se economiza. Esta fase decide se a submissão passa ou volta.

Verifique contra as diretrizes da App Store e do Play:

- Limites de caracteres de título, subtítulo e descrição, por loja
- Classificação etária: o público é estudante de ensino médio, boa parte menor
  de idade. Confira política de privacidade, coleta de dados declarada e o
  formulário de segurança de dados do Play contra o que o app realmente coleta.
  Divergência aqui é rejeição garantida.
- Alegações de resultado. "Aumente sua nota" é alegação de eficácia e costuma
  ser barrada. Prefira descrever o que o app faz, não o que o aluno vai obter.
- Screenshots: resolução exigida por dispositivo, sem texto ilegível
- Changelog: escrito para usuário final, não commits copiados

Saída: lista de problemas com severidade `bloqueante` ou `aviso`, cada um com a
diretriz correspondente e a correção sugerida.

### Fase 3 — Empacotamento (Haiku)

Monte `release-package/` a partir do que as fases anteriores produziram:

```
release-package/
  ios/            screenshots, textos, changelog
  android/        screenshots, textos, changelog, data-safety.md
  web/            build estático, notas de deploy
  CHECKLIST.md    passo a passo do que o Danilo faz manualmente
  RELATORIO.md    o que rodou, o que falhou, o que foi escalado, custo da execução
```

O `CHECKLIST.md` deve ser executável sem pensar: cada linha é uma ação com o
caminho do arquivo já resolvido.

### Fase 4 — Portão humano

Abra uma issue no GitHub com o relatório e a label `release-candidate`. Encerre.
Nenhuma ação além disso.

## Roteamento de modelo

| Fase | Modelo | Por quê |
|---|---|---|
| 0 Pré-voo | nenhum | Determinístico. Script é mais confiável e custa zero. |
| 1 Triagem | Haiku 4.5 | Volume alto, saída verificável, erro barato de corrigir. |
| 2 Conformidade | Sonnet 5 | Errar aqui custa dias de espera de revisão. |
| 3 Empacotamento | Haiku 4.5 | Transformação mecânica de texto já validado. |
| Desempate | Sonnet 5 | Só quando a Fase 1 escalou. Nunca Opus neste agente. |

Opus não entra aqui. Se você acha que precisa de Opus para preparar um release,
o problema é o prompt, não o modelo.

## Economia mecânica

- **Cache de prompt** nas diretrizes das lojas e no contexto do repositório. É o
  mesmo conteúdo toda execução, e leitura em cache custa 10% do input normal.
- **Batch API** para a Fase 1. O agente roda de madrugada e nada é urgente —
  50% de desconto por esperar algumas horas.
- **Teto rígido de gasto por execução.** Se estourar, aborte e registre na
  issue. Um loop de agente sem teto é a única forma real de tomar um susto na
  fatura.
- **Nunca reprocessar o que não mudou.** Guarde o hash do commit da última
  execução e só analise o diff.

## Sinais de que a economia está causando retrabalho

Revise o roteamento se qualquer um destes aparecer:

- Taxa de escalonamento da Fase 1 acima de 30% por três execuções seguidas
- Rejeição de loja por algo que a Fase 2 deveria ter pego
- Danilo corrigindo à mão os textos gerados na Fase 3 com frequência
- Mesmo `flake` reclassificado como regressão em execuções diferentes

Nesses casos suba a fase um degrau de modelo. O custo do modelo maior é menor
que o custo do seu tempo.
