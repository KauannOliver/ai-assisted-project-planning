# Módulo 05 — Projetos e Solicitações

## 1. Objetivo

Cadastrar e manter solicitações de desenvolvimento, tratadas como projetos desde sua criação.

## 2. Dependências

- Módulo 02;
- Módulo 03.

## 3. Identificação

- ID técnico interno;
- número da SD único;
- título;
- data de abertura.

## 4. Relacionamentos

Um projeto possui:

- um solicitante;
- um ou mais departamentos;
- um ou mais sistemas;
- uma classificação;
- um tipo de fluxo;
- uma prioridade de negócio;
- uma classe;
- várias fases;
- decisões de reuniões;
- entregas;
- histórico de negócio.

## 5. Campos

- número da SD;
- título;
- solicitante;
- departamentos;
- sistemas;
- data de abertura;
- prazo solicitado opcional;
- problema a ser resolvido;
- objetivo;
- processo atual;
- processo desejado;
- classificação;
- tipo de fluxo;
- prioridade de negócio;
- classe;
- horas derivadas da classe;
- requisito legal;
- status;
- decisão vigente do comitê;
- nota vigente;
- data da decisão;
- observação da diretoria;
- ganho mensal estimado;
- prejuízo mensal evitado estimado;
- ROI mensal;
- data real de conclusão.

## 6. Status

1. Ideia Registrada  
2. Agendar Reunião  
4. Análise TAP  
5. Processo de Software  
6. Homologação  
7. Concluído  
8. Devolvido para Solicitante  
9. Cancelado  

Não existe status 3.

## 7. Regras de status

- status e fase são independentes;
- alteração de status pode mudar as horas restantes simuladas;
- status 7, 8 e 9 não entram no motor;
- ao marcar Concluído, exigir data real de conclusão;
- Cancelado pelo comitê altera status para 9;
- Devolvido para Solicitante não entra no motor.

## 8. Horas derivadas da classe

As horas não são editáveis diretamente.

A troca de classe:

- altera as horas totais;
- exige permissão operacional;
- exige prévia de impacto quando o projeto entra no motor.

## 9. ROI mensal

```text
ROI mensal =
ganho mensal estimado
+ prejuízo mensal evitado estimado
```

Os dois campos podem ser nulos ou zero.

## 10. Prazo

- não obrigatório;
- não altera prioridade;
- usado para risco e atraso;
- após conclusão, comparar prazo com data real.

## 11. Requisito legal

- booleano;
- editável por administrador ou gerente de projetos;
- precedência absoluta no automático;
- pode ser superado por fila manual.

## 12. Projeto iniciado sem comitê

Deve aparecer alerta quando:

- projeto está em execução;
- não possui avaliação vigente válida.

O alerta permanece até a regularização em reunião.

## 13. Telas

- lista de projetos;
- novo projeto;
- edição;
- detalhe;
- histórico;
- alocações;
- entregas;
- decisões de reunião relacionadas.

## 14. APIs sugeridas

- `GET /projects`;
- `POST /projects/preview`;
- `POST /projects/confirm`;
- `GET /projects/:id`;
- `PATCH /projects/:id/preview`;
- `PATCH /projects/:id/confirm`;
- `POST /projects/:id/complete/preview`;
- `POST /projects/:id/complete/confirm`;
- `POST /projects/:id/cancel/preview`;
- `POST /projects/:id/cancel/confirm`.

## 15. Critérios de aceite

- SD única;
- projeto com múltiplos departamentos e sistemas;
- horas derivadas da classe;
- ROI calculado;
- status inválido bloqueado;
- conclusão exige data real;
- mudança relevante passa pelo impacto;
- projetos 7, 8 e 9 excluídos do motor.
