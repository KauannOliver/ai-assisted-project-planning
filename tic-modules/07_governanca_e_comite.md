# Módulo 07 — Governança e Comitê

## 1. Objetivo

Registrar reuniões, decisões da diretoria e snapshots comparáveis da carteira.

## 2. Dependências

- Módulo 05;
- Módulo 06.

## 3. Entidade CommitteeMeeting

Campos:

- id;
- data de realização;
- observações gerais;
- data de criação;
- usuário criador;
- data de atualização.

Não são necessários participantes ou anexos.

## 4. Projeto avaliado na reunião

Para cada projeto:

- decisão;
- nota inteira de 0 a 10, opcional;
- observação individual;
- ganho mensal estimado;
- prejuízo mensal evitado estimado;
- snapshot do cenário.

## 5. Decisões

- Não Avaliado;
- Priorizado;
- Segunda Fase;
- Cancelado.

## 6. Decisão vigente

Um projeto pode ser avaliado várias vezes.

A decisão da reunião mais recente passa a ser a vigente no projeto.

O histórico das decisões anteriores permanece.

## 7. Cancelamento

Ao confirmar decisão Cancelado:

- status do projeto muda para 9;
- projeto deixa o motor;
- impacto é apresentado antes de salvar.

## 8. Segunda Fase

Conceito:

- entra depois dos Priorizados;
- inclusão depende do modo global do motor.

## 9. Edição de reunião

Reuniões podem ser editadas.

Ao editar decisão com impacto:

- calcular proposta;
- mostrar impacto;
- atualizar projeto;
- atualizar cronograma;
- salvar atomicamente.

## 10. Snapshot

Cada item da reunião deve guardar:

- SD;
- título;
- departamentos;
- status;
- fase remanescente;
- decisão;
- nota;
- requisito legal;
- posição na fila;
- previsão de conclusão;
- prazo;
- risco;
- data real de conclusão;
- ganho;
- prejuízo evitado;
- ROI.

A edição posterior da reunião cria nova revisão interna do snapshot.

## 11. Comparativos

O sistema deve comparar:

- duas reuniões;
- uma reunião e o cenário atual.

Indicadores:

- projetos novos;
- projetos concluídos;
- mudanças de status;
- mudanças de decisão;
- mudanças de nota;
- antecipações;
- postergações;
- projetos em homologação;
- cancelamentos;
- variação de ROI.

## 12. Telas

- lista de reuniões;
- nova reunião;
- edição;
- detalhe;
- comparativo;
- visão guiada para apresentação.

## 13. APIs sugeridas

- `GET /committee/meetings`;
- `POST /committee/meetings/preview`;
- `POST /committee/meetings/confirm`;
- `GET /committee/meetings/:id`;
- `PATCH /committee/meetings/:id/preview`;
- `PATCH /committee/meetings/:id/confirm`;
- `GET /committee/eligible-projects`;
- `GET /committee/compare`;
- `GET /committee/meetings/:id/presentation`.

## 14. Critérios de aceite

- projeto avaliado várias vezes;
- última decisão refletida no projeto;
- decisão anterior preservada;
- cancelamento retira do motor;
- snapshot comparável;
- edição recalcula quando necessário;
- comparação reunião versus atual.
