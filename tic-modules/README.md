# TIC — Gestão de Projetos
## Pacote Modular de Especificações

Este pacote reorganiza a especificação funcional e técnica do sistema em módulos independentes, porém integrados. Cada arquivo descreve um domínio com:

- objetivo;
- escopo;
- regras de negócio;
- entidades;
- fluxos;
- telas;
- APIs sugeridas;
- eventos relevantes;
- validações;
- critérios de aceite;
- dependências com outros módulos.

## Princípio central

O sistema não é apenas um cadastro de projetos. Seu núcleo é um mecanismo de governança, priorização, capacidade e previsão que precisa responder:

- qual projeto deve ser executado primeiro;
- quais recursos trabalharão em cada fase;
- quando cada fase e projeto terminarão;
- por que uma previsão foi antecipada ou postergada;
- o que foi decidido em cada reunião;
- o que mudou entre uma reunião e o cenário atual.

## Ordem recomendada de desenvolvimento

| Ordem | Arquivo | Módulo |
|---:|---|---|
| 0 | `00_visao_produto_e_principios.md` | Visão do produto e princípios |
| 1 | `01_fundacao_arquitetura_e_seguranca.md` | Fundação técnica, autenticação e segurança |
| 2 | `02_estrutura_organizacional_e_acessos.md` | Departamentos, usuários e escopos |
| 3 | `03_cadastros_globais_e_parametros.md` | Catálogos e parâmetros globais |
| 4 | `04_recursos_capacidade_e_indisponibilidades.md` | Recursos, capacidade e calendários |
| 5 | `05_projetos_e_solicitacoes.md` | Projetos, status e dados de negócio |
| 6 | `06_fases_e_alocacoes.md` | Fases, recursos e dependências |
| 7 | `07_governanca_e_comite.md` | Reuniões, decisões e snapshots |
| 8 | `08_fila_de_prioridade.md` | Priorização automática e manual |
| 9 | `09_motor_de_alocacao_e_cronograma.md` | Agendamento, Gantt e capacidade |
| 10 | `10_preview_de_impacto_e_explicabilidade.md` | Comparação antes/depois e causas |
| 11 | `11_entregas_e_devolutivas.md` | Entregas do TI e retornos das áreas |
| 12 | `12_dashboards_e_visualizacoes.md` | Dashboards, Kanban, Gantt e heatmap |
| 13 | `13_importacao_exportacao_e_modelos_excel.md` | Excel, validação e importação |
| 14 | `14_historico_alertas_e_auditoria_de_negocio.md` | Linha do tempo e alertas |
| 15 | `15_testes_observabilidade_deploy_e_homologacao.md` | Qualidade, operação e implantação |

## Agrupamento em ciclos de entrega

### Ciclo 1 — Fundação utilizável
Módulos 1 a 4.

Resultado esperado:

- aplicação executando;
- login;
- usuários e perfis;
- departamentos;
- catálogos;
- recursos;
- indisponibilidades;
- PostgreSQL estruturado.

### Ciclo 2 — Cadastro operacional
Módulos 5 e 6.

Resultado esperado:

- projetos cadastrados;
- classes e horas;
- fases criadas;
- recursos alocados;
- validações de integridade.

### Ciclo 3 — Núcleo de governança e planejamento
Módulos 7 a 10.

Resultado esperado:

- reuniões;
- decisões;
- fila automática e manual;
- motor de capacidade;
- cronograma oficial;
- explicação das mudanças.

Este é o ciclo de maior risco e deve receber a maior cobertura de testes.

### Ciclo 4 — Acompanhamento e análise
Módulos 11 a 14.

Resultado esperado:

- entregas e devolutivas;
- dashboards;
- visualizações;
- importação e exportação;
- histórico e alertas.

### Ciclo 5 — Estabilização e produção
Módulo 15.

Resultado esperado:

- suíte de testes;
- observabilidade;
- Docker;
- deploy no servidor interno;
- homologação;
- plano de entrada em produção.

## Regra de dependência

Um módulo não deve ser iniciado como funcionalidade completa antes de suas dependências estarem estáveis.

Exemplos:

- o motor depende de projetos, fases, recursos e prioridade;
- a fila depende da decisão vigente do comitê;
- os dashboards dependem do cronograma oficial;
- o modal de impacto depende de duas execuções comparáveis do motor.

## Stack recomendada

- Next.js com TypeScript;
- NestJS com TypeScript;
- PostgreSQL;
- Prisma ORM;
- Redis;
- BullMQ;
- Tailwind CSS;
- biblioteca de componentes padronizados;
- TanStack Query;
- React Hook Form;
- Zod;
- OpenAPI;
- Vitest ou Jest;
- Playwright;
- Docker e Docker Compose.

## Convenções recomendadas

- datas armazenadas em UTC e apresentadas no fuso da empresa;
- cálculos de alocação realizados em minutos inteiros;
- exclusão lógica para cadastros referenciados;
- regras de negócio fora de controllers e componentes;
- alterações que impactem o cronograma confirmadas transacionalmente;
- contratos compartilhados entre frontend, API e motor;
- identificadores técnicos internos separados do número da SD;
- histórico de negócio compreensível para usuários;
- nenhuma regra crítica implementada apenas no frontend.
