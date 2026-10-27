# 📘 Especificação Completa do Sistema de Gestão de Projetos e Governança de TIC

## 🌟 1. Visão Geral do Sistema

O **Sistema de Gestão de Projetos de TIC** é uma plataforma corporativa web desenvolvida para planejar, priorizar, agendar e acompanhar o portfólio de tecnologia da informação de uma organização.

A plataforma combina **Governança de Projetos** (comitê diretivo, avaliação de ROI, esteira de aprovação) com um **Motor de Agendamento por Capacidade Finita**, garantindo que o cronograma oficial da empresa seja realista, transparente e imune a sobrecargas irrealistas da equipe técnica.

---

## 🏗️ 2. Arquitetura de Software e Tecnologias

O sistema é construído como um monorepo modular e containerizado com Docker Compose:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Aplicação Web (Next.js 14)                   │
│                          Porta: 3000 | Client & SSR                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST API
┌───────────────────────────────────▼────────────────────────────────────┐
│                          Backend API (NestJS)                          │
│                          Porta: 4000 | Business Logic                  │
└───────────────┬───────────────────┬────────────────────┬───────────────┘
                │                   │                    │
        ┌───────▼───────┐   ┌───────▼───────┐    ┌───────▼───────┐
        │ PostgreSQL 15 │   │    Redis 7    │    │ BullMQ Worker │
        │  (Dados/ORM)  │   │ (Cache/Filas) │    │(Processamento)│
        └───────────────┘   └───────────────┘    └───────────────┘
```

### Tecnologias Utilizadas:
- **Frontend**: Next.js 14, React 18, TanStack React Query v5, Lucide Icons, Vanilla CSS com variáveis para Design System premium corporativo.
- **Backend**: NestJS, Prisma ORM, PostgreSQL 15, Redis 7, BullMQ, TypeScript.
- **Processamento de Planilhas**: Gerador nativo e leitor de planilhas `.xlsx` / `.csv` com encoding UTF-8 BOM para compatibilidade com Microsoft Excel.
- **Orquestração de Ambiênte**: Docker Compose contendo 5 serviços (`tic_web`, `tic_api`, `tic_worker`, `tic_postgres`, `tic_redis`).

---

## 👥 3. Perfis de Acesso e Permissões (RBAC)

| Papel / Perfil | Descrição e Nível de Acesso | Permissões Principais |
| :--- | :--- | :--- |
| **`ADMIN`** | Administrador do Sistema | Acesso irrestrito a todos os módulos, usuários, parâmetros, cadastros e cargas de dados. |
| **`PROJECT_MANAGER`** | Gerente de Projetos (PMO) | Cadastro de projetos, fases, alocações de recursos, ordenação de filas e simulações. |
| **`DIRECTOR`** | Diretor / Comitê | Visualização de métricas financeiras (ROI, Ganhos), registro de notas no comitê e decisões estratégicas. |
| **`MANAGER`** | Gerente de Unidade de Negócio | Acompanhamento das solicitações do seu departamento e métricas setoriais. |

---

## 📱 4. Módulos do Sistema e Funcionalidades Detalhadas

### 4.1 📊 Dashboard Executivo (`/dashboard`)
- **Cards de Indicadores (KPIs)**: Total de projetos, projetos em execução ativa, projetos concluídos, previsão global de término do portfólio, ROI mensal acumulado e taxa de comprometimento da equipe.
- **Distribuição por Estágios**: Gráfico de barras horizontais detalhando a quantidade de demandas em cada etapa do ciclo de vida.
- **Painel de Alertas e Riscos**: Alertas visuais em tempo real para projetos sem comitê, prazos estourados ou recursos sobrecarregados.
- **Histórico de Atividades Recentes**: Timeline cronológica de eventos com nomes amigáveis (Devolutiva de Entrega, Alteração de Prioridade pela Diretoria, Novo Projeto, etc.).
- **Importação e Exportação XLSX**: Exportação do relatório geral da carteira e modal para carga de dados em massa com suporte a upload de arquivos `.xlsx`/`.csv` e download de modelos prontos.

---

### 4.2 📁 Gestão de Projetos (`/dashboard/projects`)
- **Cadastro Completo (SD)**: Registro do número SD, título, solicitante, departamento, prazo limite solicitado, estimativa de horas e marcação de **Requisito Legal**.
- **Detalhamento por Fases**: Definição das etapas de desenvolvimento (ex: *Levantamento*, *Arquitetura*, *Desenvolvimento*, *Testes*, *Homologação*) e modo de execução (*Simultâneo* ou *Sequencial*).
- **Alocação de Recursos**: Vinculação dos profissionais técnicos responsáveis por cada fase com a quantidade de minutos orçada.

---

### 4.3 🔀 Fila de Prioridades (`/dashboard/priority-queue`)
- **Modo Automático vs. Manual**: Alternância entre ordenação algorítmica ou ajuste direto pela diretoria.
- **Reordenação Drag & Drop**: Interface intuitiva para arrastar e soltar projetos na posição desejada.
- **Simulação de Impacto Instantânea**: Ao mover a posição de um projeto na fila, o sistema calcula previamente quantos dias os demais projetos serão postergados ou adiantados antes de salvar a nova sequência.

---

### 4.4 ⚖️ Comitê de Governança e Atas (`/dashboard/committee`)
- **Registro de Reuniões**: Criação de atas de deliberação do comitê executivo com data e observações.
- **Avaliação de Projetos**: Atribuição da decisão do comitê (`PRIORIZADO`, `SEGUNDA_FASE`, `CANCELADO`), nota da diretoria (0 a 10) e estimativas financeiras (Ganho Mensal / Perda Evitada).
- **Aba de Comparativo de Evolução ("Antes vs. Depois")**: Permite selecionar duas reuniões históricas ou "Cenário Atual vs. Reunião Passada" para comparar a variação do ROI, projetos adiantados/postergados e trocas de status.

---

### 4.5 📅 Cronograma Oficial e Heatmap (`/dashboard/schedule`)
- **Gráfico Gantt Interativo**: Visualização gráfica do planejamento temporal de cada projeto e suas fases.
- **Simulação Dinâmica de Datas**: Projetos que possuem recursos alocados mas ainda não têm data limite fixa recebem estimativas simuladas pelo motor, permitindo planejamento antecipado.
- **Matriz de Ocupação (Heatmap)**: Tabela de capacidade por recurso e por semana/dia, destacando níveis de ocupação em cores (Livre, Moderado, Ideal, Sobrecarga).

---

### 4.6 🧑‍💻 Recursos e Capacidade (`/dashboard/resources`)
- **Cadastro de Profissionais**: Registro de nome, cargo/papel, modalidade de trabalho, carga horária semanal e limite de projetos em paralelo recomendados (WIP).
- **Tabela Simplificada**: Exibição limpa e focada em métricas de produtividade líquida diária e semanal.
- **Gestão de Indisponibilidades (`/dashboard/calendar`)**: Cadastro de férias, folgas, licenças e feriados que impactam a disponibilidade dos recursos no motor.

---

### 4.7 ⚙️ Parâmetros Globais de Governança (`/dashboard/parameters`)
- **Organização por Abas Temáticas**:
  1. *Elegibilidade de Projetos*: Define quais demandas entram na simulação de capacidade.
  2. *Regras de Fila e Prioridade*: Configura a forma de ordenação das demandas.
  3. *Motor de Agendamento*: Ajusta parâmetros do cálculo (dias úteis, margem de risco, feriados).
  4. *Alertas e Limiares*: Define percentuais para disparo de avisos de sobrecarga e atrasos.
- **Simulador de Alterações**: Modal de confirmação que exibe o impacto exato no cronograma de todos os projetos afetados antes de salvar o novo parâmetro.

---

## 🔄 5. Ciclo de Vida do Projeto (Estágios)

```
[1 - Ideia Registrada]
       │
       ▼
[2 - Agendar Reunião] ────► [Avaliação do Comitê]
       │
       ▼
[4 - Análise TAP]
       │
       ▼
[5 - Processo de Software] (Desenvolvimento em Andamento)
       │
       ▼
[6 - Homologação] (Testes finais do Solicitante)
       │
       ├────────────────────────┬────────────────────────┐
       ▼                        ▼                        ▼
[7 - Concluído]     [8 - Devolvido p/ Solicitante]   [9 - Cancelado]
```

---

## 📄 6. Modelos de Importação e Exportação de Planilhas

O sistema fornece utilitários para integração com planilhas Excel:
1. **`Modelo_Importacao_Projetos.csv`**: Modelo com colunas padronizadas (`Número SD`, `Título`, `Solicitante`, `Departamento`, `Status`, `Prioridade`, `Score`, `Data Início`, `Data Término`).
2. **`Modelo_Importacao_Alocacoes.csv`**: Modelo para atribuição em massa de recursos às fases.
3. **Exportação Executiva**: Download de relatório completo em `.xlsx`/`.csv` contendo todos os dados e indicadores consolidados do portfólio.
