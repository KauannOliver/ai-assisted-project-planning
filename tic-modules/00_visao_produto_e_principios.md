# Módulo 00 — Visão do Produto e Princípios

## 1. Objetivo

Definir a visão única do TIC — Gestão de Projetos e orientar todas as decisões de produto, arquitetura e implementação.

## 2. Definição do produto

O TIC será uma plataforma interna para:

- registrar solicitações de desenvolvimento;
- governar decisões de diretoria;
- priorizar a carteira de projetos;
- planejar a capacidade dos recursos de TI;
- prever datas de início e conclusão;
- explicar alterações de cronograma;
- acompanhar entregas e devolutivas;
- apresentar informações operacionais, gerenciais e executivas.

Solicitação e projeto são a mesma entidade de negócio.

O número da SD é o identificador funcional principal.

## 3. Usuários

- Administrador;
- Gerente de Projetos;
- Gerente;
- Diretor.

Recursos técnicos não acessam o sistema na primeira versão.

## 4. Diferenciais obrigatórios

### 4.1. Previsão baseada em capacidade

A previsão deve considerar:

- horas estimadas pela classe;
- percentual das fases;
- recursos alocados;
- capacidade líquida;
- ordem de prioridade;
- indisponibilidades;
- fases sequenciais;
- recursos simultâneos ou sequenciais.

### 4.2. Explicabilidade

Toda mudança relevante precisa informar:

- o que mudou;
- quais projetos foram impactados;
- quantos dias foram antecipados ou postergados;
- quais recursos participaram do impacto;
- qual foi a cadeia causal.

### 4.3. Governança

Cada reunião precisa registrar:

- data;
- observação geral;
- projetos avaliados;
- decisão individual;
- nota;
- comentário;
- snapshot do cenário.

### 4.4. Visões por público

- operação para administrador e gerente de projetos;
- leitura departamental para gerentes;
- consolidação executiva para diretores.

## 5. Princípios de arquitetura

1. Monólito modular antes de microserviços.
2. Motor independente do framework web.
3. Regras determinísticas.
4. PostgreSQL como fonte transacional.
5. Cronograma oficial único.
6. Prévia antes de salvar mudanças de impacto.
7. Histórico de negócio, não histórico completo de simulações.
8. Cálculo em minutos.
9. Componentes visuais padronizados.
10. Testes de cenário como parte da especificação.

## 6. Fora do escopo

- Scrum completo;
- backlog de tarefas;
- sprints;
- ranking de recursos;
- habilidades de recursos;
- escolha automática de recursos;
- edição visual do Gantt;
- relatórios personalizáveis;
- aplicativo móvel nativo;
- apontamento de horas reais;
- Microsoft Entra ID na primeira versão;
- notificações por e-mail ou Teams na primeira versão;
- histórico recuperável de todas as simulações.

## 7. Critérios globais de sucesso

- previsão confiável;
- explicação clara de mudanças;
- preparação rápida de reuniões;
- manutenção simples das regras;
- ausência de regras duplicadas em várias camadas;
- fila automática previsível;
- fila manual reversível;
- visualização correta por departamento;
- consistência transacional entre alteração e cronograma.
