# Módulo 12 — Dashboards e Visualizações

## 1. Objetivo

Apresentar a carteira em formatos operacionais, gerenciais e executivos.

## 2. Dependências

- Módulo 07;
- Módulo 09;
- Módulo 11;
- Módulo 14 para histórico completo da interface.

## 3. Dashboard geral

Indicadores:

- total de projetos;
- por status;
- por decisão;
- por classificação;
- por sistema;
- em risco;
- atrasados;
- iniciados sem comitê;
- fases sem recurso;
- entregas sem devolutiva;
- recursos sobrecarregados;
- capacidade total;
- capacidade utilizada;
- data final da carteira.

## 4. Dashboard de gerente

Limitado aos departamentos do usuário.

- total;
- concluídos;
- cancelados;
- homologação;
- processo de software;
- entregas pendentes;
- risco;
- atraso;
- novos desde a última reunião;
- previsão de conclusão;
- por sistema;
- por prioridade;
- tempo médio de devolutiva;
- últimas movimentações.

## 5. Dashboard de diretor

Além dos indicadores gerenciais:

- ganho mensal;
- prejuízo evitado;
- ROI mensal;
- requisitos legais;
- priorizados;
- evolução entre reuniões;
- capacidade comprometida;
- entregas previstas por período.

## 6. Kanban

Três modos:

- por status;
- por fase remanescente;
- por decisão do comitê.

Somente leitura.

## 7. Gantt em matriz

Estrutura expansível:

```text
Projeto
└── Fase
    └── Recurso
```

Colunas:

- horas;
- início;
- término;
- duração;
- risco;
- modo de execução;
- indisponibilidades relevantes.

Somente leitura.

## 8. Heatmap semanal

Linhas: recursos.

Colunas: dias da semana.

Informações:

- minutos alocados;
- capacidade;
- percentual;
- quantidade de projetos;
- indisponibilidade;
- sobrecarga.

## 9. Calendário

Somente indisponibilidades.

- visão mensal;
- nomes em lista;
- indicação global;
- filtros.

## 10. Visão guiada de reunião

- reunião selecionada;
- resumo;
- projetos avaliados;
- comparação com atual;
- transições;
- conclusões;
- cancelamentos;
- novos projetos;
- ROI;
- navegação sequencial.

## 11. Lista de projetos

- busca por SD e título;
- filtros;
- ordenação;
- seleção de colunas;
- paginação;
- acesso ao detalhe;
- exportação Excel.

## 12. APIs sugeridas

- `GET /dashboards/overview`;
- `GET /dashboards/manager`;
- `GET /dashboards/director`;
- `GET /views/kanban`;
- `GET /views/gantt`;
- `GET /views/heatmap`;
- `GET /views/unavailability-calendar`;
- `GET /views/committee-presentation`.

## 13. Critérios de aceite

- escopo departamental respeitado;
- indicadores consistentes;
- filtros por departamento;
- Kanban em três formatos;
- Gantt expansível;
- heatmap semanal;
- calendário visual;
- visão guiada de reunião.
