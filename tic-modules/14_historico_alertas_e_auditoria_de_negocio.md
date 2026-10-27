# Módulo 14 — Histórico, Alertas e Auditoria de Negócio

## 1. Objetivo

Registrar movimentações compreensíveis e destacar situações que exigem atenção.

## 2. Dependências

- Módulos 05 a 11.

## 3. Histórico de negócio

Não será um log técnico completo.

Eventos iniciais:

- projeto criado;
- status alterado;
- classe alterada;
- requisito legal alterado;
- decisão do comitê alterada;
- reunião criada ou editada;
- projeto cancelado;
- fila manual ativada;
- fila automática restaurada;
- recurso incluído ou removido;
- modo de execução alterado;
- indisponibilidade criada, alterada ou removida;
- entrega criada;
- devolutiva registrada;
- prazo alterado;
- projeto concluído.

## 4. Entidade BusinessEvent

Campos:

- id;
- aggregateType;
- aggregateId;
- eventType;
- description;
- metadata resumida;
- userId;
- createdAt.

## 5. Resumo de impacto

Quando aplicável:

- data final anterior;
- data final nova;
- diferença;
- principais projetos;
- causa principal.

Não armazenar cronograma completo.

## 6. Retenção

Os eventos permanecem enquanto o registro de negócio existir.

A restrição “até o motor ser recalculado” se aplica ao detalhamento transitório da simulação, não aos eventos essenciais de negócio.

## 7. Alertas prioritários

1. projeto iniciado sem comitê;
2. prazo em risco;
3. atraso confirmado;
4. entrega sem devolutiva;
5. recurso sobrecarregado;
6. fase sem recurso.

## 8. Modelo de alerta

Alertas podem ser calculados dinamicamente ou materializados.

Campos sugeridos:

- tipo;
- severidade;
- projeto;
- recurso;
- departamento;
- mensagem;
- data de detecção;
- resolvido em.

## 9. Regras

### Iniciado sem comitê

Projeto em execução sem decisão vigente.

### Prazo em risco

Previsão próxima ou posterior ao prazo conforme parâmetro.

### Atrasado

Previsão posterior ao prazo ou conclusão real posterior.

### Entrega sem devolutiva

Entrega sem retorno.

### Recurso sobrecarregado

Projetos simultâneos acima do limite.

### Fase sem recurso

Fase remanescente sem alocação.

## 10. Telas

- linha do tempo no projeto;
- feed recente no dashboard;
- central de alertas;
- filtros por tipo, severidade e departamento.

## 11. APIs sugeridas

- `GET /projects/:id/history`;
- `GET /history/recent`;
- `GET /alerts`;
- `GET /alerts/counts`;
- `POST /alerts/:id/acknowledge`, caso futuramente necessário.

## 12. Critérios de aceite

- eventos compreensíveis;
- histórico ordenado;
- últimas movimentações nos dashboards;
- alertas calculados corretamente;
- escopo departamental aplicado;
- sem exposição de detalhes técnicos desnecessários.
