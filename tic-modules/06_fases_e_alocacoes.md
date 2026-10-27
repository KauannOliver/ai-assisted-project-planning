# Módulo 06 — Fases e Alocações

## 1. Objetivo

Representar as fases obrigatórias do projeto, distribuir horas e configurar os recursos responsáveis.

## 2. Dependências

- Módulo 03;
- Módulo 04;
- Módulo 05.

## 3. Fases obrigatórias

Todos os projetos possuem:

1. Gestão de Projetos;
2. Levantamento;
3. Arquitetura;
4. Design;
5. Desenvolvimento;
6. Qualidade;
7. Entrega/Aplicação;
8. Homologação;
9. Golive.

Nenhuma fase pode ser removida do projeto.

## 4. Horas por fase

```text
horasDaFase =
horasDaClasse × percentualDaFase
```

Cálculo interno em minutos.

Arredondamento deve preservar o total exato do projeto.

Recomendação:

- converter total da classe para minutos;
- distribuir pelas fases;
- aplicar ajuste de resíduos na fase de maior percentual ou por regra estável.

## 5. Recursos por fase

- seleção manual;
- um ou vários recursos;
- recurso precisa estar ativo;
- projeto pode ser salvo com fase sem recurso;
- fase sem recurso gera alerta;
- ausência de recurso impede previsão final completa.

## 6. Divisão igual

Com `n` recursos:

```text
minutosPorRecurso =
minutosDaFase ÷ n
```

Resíduos de minutos devem ser distribuídos de forma determinística.

Não existe edição manual de percentual.

## 7. Modo de execução

### Simultâneo

- todos começam quando a fase está liberada;
- cada um executa sua parcela;
- a fase termina quando o último termina.

### Sequencial

- ordem definida pelo usuário;
- cada recurso começa após o anterior concluir;
- dependência integral;
- não existe dependência parcial.

## 8. Dependência entre fases

- todas são sequenciais;
- a fase seguinte espera a anterior;
- Gestão de Projetos não é paralela; é executada no início;
- não há sobreposição entre fases.

## 9. Horas remanescentes por status

### Status 1

Todas as fases com 100%.

### Status 2

- Gestão de Projetos: 50%;
- demais fases: 100%.

### Status 4

- Arquitetura em diante: 100%.

### Status 5

- Design em diante: 100%.

### Status 6

- Homologação e Golive: 100%.

### Status 7, 8 e 9

Nenhuma fase entra no motor.

## 10. Fase exibida no Kanban

Como não há progresso informado, a fase corrente visual será a primeira fase remanescente derivada do status.

## 11. Telas

No detalhe do projeto:

- acordeão por fase;
- horas da fase;
- recursos;
- modo simultâneo/sequencial;
- ordem dos recursos;
- alerta de ausência;
- previsão calculada, quando disponível.

## 12. APIs sugeridas

- `GET /projects/:id/phases`;
- `PUT /projects/:id/phases/:phaseId/resources/preview`;
- `PUT /projects/:id/phases/:phaseId/resources/confirm`;
- `PUT /projects/:id/phases/:phaseId/execution-mode/preview`;
- `PUT /projects/:id/phases/:phaseId/execution-mode/confirm`.

## 13. Critérios de aceite

- todas as fases criadas automaticamente;
- percentuais aplicados corretamente;
- divisão igual;
- ordem sequencial respeitada;
- simultâneo corretamente calculado;
- mudança de recurso recalcula;
- fase sem recurso gera impedimento;
- status determina fases remanescentes.
