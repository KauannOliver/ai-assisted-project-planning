# Módulo 03 — Cadastros Globais e Parâmetros

## 1. Objetivo

Centralizar catálogos e parâmetros utilizados por projetos, fila, capacidade e motor.

## 2. Dependências

- Módulo 01;
- Módulo 02.

## 3. Cadastros editáveis

- departamentos;
- sistemas;
- classificações;
- tipos de fluxo;
- prioridades de negócio;
- classes;
- fases;
- tipos de indisponibilidade;
- modalidades de recurso;
- cargos;
- parâmetros globais.

## 4. Valores iniciais

### Sistemas

- Azure;
- ChatBot;
- Design UI;
- Fluig;
- PowerBI;
- Protheus;
- RM;
- Reports;
- SQL Server;
- Site;
- UX.

### Classificações

- Core;
- Legislação/Cliente;
- Inovação;
- Melhoria;
- Correção/Performance;
- Estratégia.

### Tipos de fluxo

- Nova Demanda/Projeto;
- Manutenção/Sustentação.

### Prioridades de negócio

| Prioridade | Ordem |
|---|---:|
| Alta | 3 |
| Média | 2 |
| Baixa | 1 |

### Classes

| Classe | Horas |
|---|---:|
| A | 4 |
| B | 8 |
| C | 20 |
| D | 40 |
| E | 60 |
| F | 80 |
| G | 120 |
| H | 200 |
| I | 300 |
| J | 400 |
| K | 600 |

As horas são obrigatoriamente derivadas da classe.

## 5. Fases globais

| Ordem | Fase | Percentual |
|---:|---|---:|
| 1 | Gestão de Projetos | 5% |
| 2 | Levantamento | 10% |
| 3 | Arquitetura | 10% |
| 4 | Design | 10% |
| 5 | Desenvolvimento | 40% |
| 6 | Qualidade | 10% |
| 7 | Entrega/Aplicação | 2,5% |
| 8 | Homologação | 10% |
| 9 | Golive | 2,5% |

A soma deve ser exatamente 100%.

## 6. Parâmetros globais iniciais

### Elegibilidade

- somente priorizados;
- priorizados e segunda fase;
- todos os elegíveis.

### Fila

- modo automático;
- modo manual;
- ordem das decisões;
- ordem dos status;
- ordem da prioridade de negócio.

### Motor

- data inicial sempre igual à data atual;
- unidade de cálculo em minutos;
- dias úteis de segunda a sexta;
- quantidade de projetos exibidos no resumo de impacto;
- limite padrão de WIP;
- tolerância para risco de atraso;
- comportamento de feriados;
- percentuais das fases.

### Alertas

- limites de sobrecarga;
- dias para classificar devolutiva pendente, caso futuramente necessário.

## 7. Regras

- parâmetros são globais;
- não há versionamento;
- não há vigência futura;
- administrador e gerente de projetos podem editar;
- alteração que afeta o motor exige prévia;
- cadastros usados devem ser desativados em vez de removidos;
- classes não permitem alteração de horas diretamente no projeto.

## 8. APIs sugeridas

- `GET /catalogs/:type`;
- `POST /catalogs/:type`;
- `PATCH /catalogs/:type/:id`;
- `POST /catalogs/:type/:id/activate`;
- `POST /catalogs/:type/:id/deactivate`;
- `GET /parameters`;
- `POST /parameters/preview`;
- `POST /parameters/confirm`.

## 9. Critérios de aceite

- alteração de percentuais bloqueada se soma diferente de 100%;
- alteração de classe atualiza todos os novos usos;
- catálogos inativos não aparecem em novos cadastros;
- dados antigos continuam legíveis;
- parâmetros que afetam motor passam pelo fluxo de impacto;
- ordem de prioridade de negócio editável.
