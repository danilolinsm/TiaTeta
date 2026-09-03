"""
Teste isolado da Fase 2 (conformidade com Sonnet).

Injeta 3 problemas plantados de proposito no metadata de teste e confere se o
agente pega os 3. Se pegar menos que isso, o prompt CONFORMIDADE_SISTEMA em
agent.py precisa de ajuste antes de seguir para o dia 7.

Uso:
    export ANTHROPIC_API_KEY=sk-...
    python testar_fase2.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from agent import fase2_conformidade, Orcamento  # noqa: E402

# 3 problemas plantados de proposito: um de alegacao de eficacia, um de
# classificacao etaria (Made for Kids ligado com publico de 15-18), um de
# data safety divergente (nao declara Android ID mas o app usa analytics
# que le esse identificador).
METADADOS_TESTE = {
    "app": {"publico_alvo": "estudantes de 15 a 18 anos"},
    "app_store": {
        "descricao_promocional": "Garanta sua aprovação no ENEM com o Tia Teta!",
        "made_for_kids": True
    },
    "play_store": {
        "data_safety": {
            "coleta_identificadores_dispositivo": False,
            "_nota_binario": "o app usa um SDK de analytics que lê Android ID"
        }
    }
}

PROBLEMAS_ESPERADOS = [
    "alegação de eficácia/resultado na descrição",
    "made_for_kids ligado com público adolescente, não infantil",
    "data safety declarando não coletar identificador que o binário coleta",
]


async def main():
    orcamento = Orcamento(teto=0.30)
    saida = await fase2_conformidade(METADADOS_TESTE, [], orcamento)

    print("--- saída do agente ---")
    print(saida)
    print(f"\ncusto: ${orcamento.gasto:.4f}\n")

    print("--- problemas que deveriam ter sido pegos ---")
    for p in PROBLEMAS_ESPERADOS:
        print(f"  - {p}")
    print("\nConfira manualmente se os 3 aparecem na saída acima. Se faltar "
          "algum, ajuste CONFORMIDADE_SISTEMA em agent.py e rode de novo.")


if __name__ == "__main__":
    asyncio.run(main())
