#!/usr/bin/env bash
# Fase 0 do agente de QA. Custo zero, sem LLM.
# Tudo que um script resolve de forma confiavel resolve aqui, nao no modelo.
# Saida: preflight.json, consumido pelo agent.py

set -uo pipefail
OUT="preflight.json"
BUILD_OK=true

run() {
  local nome="$1"; shift
  local inicio=$(date +%s)
  local saida
  saida=$("$@" 2>&1)
  local codigo=$?
  local dur=$(( $(date +%s) - inicio ))
  jq -n --arg n "$nome" --arg s "$saida" --argjson c "$codigo" --argjson d "$dur" \
    '{etapa:$n, codigo:$c, duracao_s:$d, saida:$s}'
  return $codigo
}

echo "[preflight] iniciando" >&2
RESULTADOS=()

RESULTADOS+=("$(run lint npm run lint)")
RESULTADOS+=("$(run typecheck npm run typecheck)")

# Build antes dos testes: se nao compila, nada abaixo importa.
if ! saida_build=$(run build npm run build); then BUILD_OK=false; fi
RESULTADOS+=("$saida_build")

if [ "$BUILD_OK" = true ]; then
  RESULTADOS+=("$(run testes npm test -- --reporter=json)")
  RESULTADOS+=("$(run auditoria npm audit --audit-level=high --json)")

  # Tamanho do bundle: limite duro, nao opiniao de modelo.
  TAM=$(du -sk dist 2>/dev/null | cut -f1 || echo 0)
  LIMITE=8192
  RESULTADOS+=("$(jq -n --argjson t "$TAM" --argjson l "$LIMITE" \
    '{etapa:"bundle", codigo:(if $t > $l then 1 else 0 end), tamanho_kb:$t, limite_kb:$l}')")

  # Screenshots: captura mecanica, sem modelo envolvido.
  RESULTADOS+=("$(run screenshots npx playwright test --config=screenshots.config.ts)")
fi

COMMIT=$(git rev-parse HEAD)
ANTERIOR=$(cat .last-qa-commit 2>/dev/null || echo "")

printf '%s\n' "${RESULTADOS[@]}" | jq -s \
  --arg commit "$COMMIT" \
  --arg anterior "$ANTERIOR" \
  --argjson build_ok "$BUILD_OK" \
  '{commit:$commit, commit_anterior:$anterior, build_ok:$build_ok, etapas:.}' > "$OUT"

echo "[preflight] escrito em $OUT" >&2
[ "$BUILD_OK" = true ] || exit 2
