# Módulo 09 — Motor de Alocação e Cronograma

## 1. Objetivo

Distribuir minutos de trabalho nos recursos e produzir a previsão oficial da carteira.

## 2. Dependências

- Módulo 04;
- Módulo 05;
- Módulo 06;
- Módulo 08.

## 3. Princípios

- motor determinístico;
- cálculo em minutos inteiros;
- data inicial igual à data atual;
- somente presente e futuro;
- prioridade mais alta primeiro;
- recurso definido manualmente;
- fases sequenciais;
- cronograma oficial único.

## 4. Entrada do motor

```ts
type EngineInput = {
  calculationDate: string;
  projects: ProjectInput[];
  resources: ResourceInput[];
  unavailabilities: UnavailabilityInput[];
  queue: QueueInput;
  phaseDefinitions: PhaseDefinitionInput[];
  parameters: EngineParameters;
};
```

## 5. Saída

```ts
type EngineResult = {
  projects: ProjectSchedule[];
  phases: PhaseSchedule[];
  allocations: DailyResourceAllocation[];
  utilization: ResourceUtilization[];
  warnings: EngineWarning[];
  explanations: EngineExplanation[];
  portfolioEndDate: string | null;
};
```

## 6. Capacidade diária

Usar capacidade líquida do Módulo 04.

Descontar indisponibilidades do dia.

Nunca permitir capacidade negativa.

## 7. Algoritmo conceitual

```text
1. Selecionar projetos elegíveis.
2. Obter fila final.
3. Gerar trabalho remanescente por fase.
4. Validar recursos.
5. Para cada dia útil, a partir da data atual:
   a. calcular capacidade disponível de cada recurso;
   b. localizar o trabalho disponível do projeto mais prioritário;
   c. respeitar dependências de fase e recurso;
   d. alocar minutos;
   e. usar capacidade restante no próximo projeto;
   f. registrar utilização e alertas;
   g. continuar até concluir todos os trabalhos calculáveis.
6. Produzir previsões e impedimentos.
```

## 8. Disponibilidade do trabalho

Uma parcela de trabalho pode iniciar quando:

- projeto é elegível;
- fases anteriores concluídas;
- recurso está disponível;
- em execução sequencial, recurso anterior concluiu;
- fase possui recurso;
- data não está indisponível.

## 9. Recursos simultâneos

Cada recurso recebe sua divisão igual.

A fase termina quando todos concluírem.

## 10. Recursos sequenciais

Cada recurso recebe sua divisão igual.

A ordem é obrigatória.

O seguinte inicia após o anterior.

## 11. Prioridade por recurso

Quando um recurso atende vários projetos:

- consumir primeiro o de maior prioridade;
- concluir o trabalho disponível desse projeto antes do seguinte;
- capacidade restante do dia pode seguir para o próximo.

## 12. WIP

O motor pode ultrapassar o limite.

Ao ultrapassar, registrar alerta de sobrecarga.

## 13. Fase sem recurso

Resultado:

- projeto não possui data final confiável;
- marcar como impedido;
- listar fases sem recurso;
- não inventar previsão.

## 14. Prazo e risco

### Dentro do prazo

Conclusão prevista anterior ou igual ao prazo.

### Em risco

Regra parametrizável baseada em proximidade ou pequena folga.

### Atrasado

Conclusão prevista posterior ao prazo.

### Concluído com atraso

Data real posterior ao prazo.

## 15. Persistência do cronograma atual

Tabelas sugeridas:

- CurrentProjectSchedule;
- CurrentPhaseSchedule;
- CurrentResourceAllocation;
- CurrentResourceUtilization;
- CurrentEngineWarning.

Uma nova confirmação substitui o cronograma atual.

## 16. Worker

Execuções pesadas devem ocorrer no worker.

A API cria trabalho, acompanha status e devolve a comparação.

## 17. APIs sugeridas

- `POST /engine/calculate`;
- `GET /engine/status/:jobId`;
- `GET /schedule/projects`;
- `GET /schedule/projects/:projectId`;
- `GET /schedule/gantt`;
- `GET /capacity/heatmap`.

## 18. Critérios de aceite

- mesmo input gera mesmo resultado;
- nenhuma alocação em indisponibilidade;
- fases sequenciais;
- prioridade respeitada;
- divisão simultânea e sequencial;
- cálculo por minuto;
- cronograma começa na data atual;
- status determina trabalho restante;
- fase sem recurso impede previsão;
- alertas de WIP.
