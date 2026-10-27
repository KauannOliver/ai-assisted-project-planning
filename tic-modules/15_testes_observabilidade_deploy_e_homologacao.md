# Módulo 15 — Testes, Observabilidade, Deploy e Homologação

## 1. Objetivo

Garantir qualidade, previsibilidade operacional e implantação segura no servidor interno.

## 2. Dependências

Todos os módulos anteriores.

## 3. Estratégia de testes

### Unitários

- fórmulas de capacidade;
- distribuição de minutos;
- seleção de fases por status;
- comparador da fila;
- dependências;
- risco de atraso;
- indicadores;
- ROI.

### Cenários do motor

Casos obrigatórios:

1. um projeto e um recurso;
2. vários projetos no mesmo recurso;
3. requisito legal;
4. fila manual;
5. indisponibilidade total;
6. indisponibilidade parcial;
7. recursos simultâneos;
8. recursos sequenciais;
9. fase sem recurso;
10. WIP excedido;
11. mudança de classe;
12. mudança de status;
13. Segunda Fase;
14. Não Avaliado;
15. conflito em cadeia;
16. mudança que antecipa e posterga projetos.

### Integração

- transação de confirmação;
- persistência do cronograma;
- atualização de decisão;
- importação;
- permissões.

### End-to-end

- login e troca de senha;
- cadastro de projeto;
- alocação;
- reunião;
- fila;
- impacto;
- dashboard;
- entrega e devolutiva.

## 4. Testes de regressão

Criar catálogo de cenários de referência com entrada e saída esperada.

Nenhuma alteração no motor deve ser aceita sem executar toda a suíte.

## 5. Observabilidade

### Logs

- estruturados;
- `traceId`;
- usuário;
- endpoint;
- duração;
- resultado;
- falha do motor.

### Métricas

- tempo de cálculo;
- projetos por execução;
- alocações geradas;
- falhas;
- jobs em fila;
- consumo de memória;
- conexões PostgreSQL;
- latência da API.

### Saúde

- `/health`;
- `/ready`;
- PostgreSQL;
- Redis;
- worker.

## 6. Desempenho

Cenário inicial:

- 80 a 100 projetos cadastrados;
- cerca de 70 ativos;
- 30 a 40 recursos;
- 4 a 5 usuários;
- mais de 10 recálculos em dias de maior movimentação.

Testar volumes superiores para margem de crescimento.

## 7. Docker

Serviços:

- web;
- api;
- worker;
- PostgreSQL;
- Redis;
- proxy opcional.

Persistência:

- volume PostgreSQL;
- backups;
- arquivos temporários fora do container.

## 8. Deploy

- servidor interno;
- nova porta;
- aplicação antiga paralela temporariamente;
- migrations antes da subida;
- rollback documentado;
- backup anterior ao deploy.

## 9. Homologação

Responsável: proprietário do produto com apoio dos agentes de IA.

Cada módulo deve possuir:

- checklist;
- critérios de aceite;
- dados de teste;
- evidências;
- registro de pendências.

## 10. Entrada em produção

Condições:

- testes aprovados;
- backup;
- usuários cadastrados;
- parâmetros revisados;
- classes e fases conferidas;
- recursos cadastrados;
- dados iniciais importados;
- cronograma validado;
- plano de retorno.

## 11. Critérios de aceite

- suíte automatizada;
- cenários do motor versionados;
- logs e métricas;
- health checks;
- Docker Compose reproduzível;
- backup e rollback;
- homologação registrada;
- documentação de operação.
