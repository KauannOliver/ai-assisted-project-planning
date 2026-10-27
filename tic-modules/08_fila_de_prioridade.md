# Módulo 08 — Fila de Prioridade

## 1. Objetivo

Ordenar os projetos elegíveis de forma automática ou manual.

## 2. Dependências

- Módulo 03;
- Módulo 05;
- Módulo 07.

## 3. Elegibilidade

Sempre excluir status:

- 7. Concluído;
- 8. Devolvido para Solicitante;
- 9. Cancelado.

Modos:

### Somente priorizados

Inclui Priorizado.

### Priorizados e Segunda Fase

Inclui:

1. Priorizado;
2. Segunda Fase.

### Todos os elegíveis

Inclui:

1. Priorizado;
2. Segunda Fase;
3. Não Avaliado.

## 4. Modo automático

A ordenação é por precedência, não soma de pontos.

Ordem geral:

1. requisito legal;
2. grupo da decisão;
3. status;
4. nota da diretoria;
5. prioridade de negócio;
6. data de abertura.

## 5. Requisito legal

- precedência absoluta no automático;
- entre requisitos legais:
  1. status mais avançado;
  2. data de abertura mais antiga.

## 6. Grupo de decisão

Ordem:

1. Priorizado;
2. Segunda Fase;
3. Não Avaliado.

Aplicado somente aos grupos incluídos pelo parâmetro.

## 7. Status

Ordem:

1. 6. Homologação;
2. 5. Processo de Software;
3. 4. Análise TAP;
4. 2. Agendar Reunião;
5. 1. Ideia Registrada.

## 8. Nota

- maior primeiro;
- valor inteiro;
- vazio tratado como zero.

## 9. Prioridade de negócio

Ordem inicial:

1. Alta;
2. Média;
3. Baixa.

Editável globalmente.

## 10. Data de abertura

Mais antiga primeiro.

É o desempate final funcional.

## 11. Modo manual

- copiar fila automática ao ativar;
- permitir drag-and-drop;
- reorganizar vários projetos;
- ordem manual supera tudo;
- não exigir justificativa;
- permanece até restaurar automático;
- mostrar posição manual e automática;
- gerentes e diretores veem que está manual.

## 12. Estado da fila

Entidade sugerida:

### PriorityQueueState

- mode;
- updatedAt;
- updatedBy;
- manualOrder.

A ordem manual deve referenciar projetos elegíveis e tratar novos projetos de forma estável.

Recomendação para novos projetos enquanto manual:

- inserir ao final;
- mostrar alerta;
- permitir reposicionamento.

## 13. APIs sugeridas

- `GET /priority-queue`;
- `POST /priority-queue/mode/preview`;
- `POST /priority-queue/mode/confirm`;
- `POST /priority-queue/manual-order/preview`;
- `POST /priority-queue/manual-order/confirm`;
- `POST /priority-queue/restore-auto/preview`;
- `POST /priority-queue/restore-auto/confirm`.

## 14. Critérios de aceite

- ordenação determinística;
- requisito legal primeiro no automático;
- grupo de comitê respeitado;
- status respeitado;
- nota vazia igual a zero;
- manual supera requisito legal;
- restauração automática;
- posição automática visível no manual;
- novos projetos tratados sem corromper ordem.
