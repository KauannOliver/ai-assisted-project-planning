# Módulo 13 — Importação, Exportação e Modelos Excel

## 1. Objetivo

Permitir carga em massa e extração padronizada dos dados.

## 2. Dependências

- Módulos 03 a 12.

## 3. Exportações

- projetos;
- fila;
- cronograma;
- recursos;
- capacidade;
- indisponibilidades;
- reuniões;
- decisões;
- entregas;
- devolutivas;
- indicadores.

## 4. Modelos de importação

### Projetos

Colunas sugeridas:

- SD;
- título;
- solicitante;
- departamentos;
- sistemas;
- data de abertura;
- prazo;
- status;
- classificação;
- fluxo;
- prioridade;
- classe;
- requisito legal;
- ganho;
- prejuízo evitado;
- campos descritivos.

### Alocações

- SD;
- fase;
- recurso;
- modo de execução;
- ordem sequencial.

### Indisponibilidades

- recurso;
- tipo;
- início;
- fim;
- horas por dia;
- global;
- recorrente;
- observação.

## 5. Fluxo de importação

1. download do modelo;
2. preenchimento;
3. envio;
4. validação estrutural;
5. validação de domínio;
6. prévia;
7. erros por linha;
8. correção ou confirmação;
9. cálculo do impacto;
10. gravação transacional.

## 6. Validações

- SD única;
- classe existente;
- status válido;
- departamentos existentes;
- sistemas existentes;
- recursos existentes;
- fases válidas;
- ordem sequencial sem duplicidade;
- datas válidas;
- percentuais e números no formato esperado.

## 7. Estratégia de erros

Não importar parcialmente por padrão.

A prévia deve informar:

- linha;
- coluna;
- código do erro;
- descrição;
- valor recebido;
- sugestão.

## 8. Segurança

- limite de tamanho;
- tipos permitidos;
- leitura em ambiente controlado;
- nenhum macro executado;
- arquivo temporário removido após processamento.

## 9. APIs sugeridas

- `GET /imports/templates/:type`;
- `POST /imports/:type/validate`;
- `POST /imports/:type/preview-impact`;
- `POST /imports/:type/confirm`;
- `GET /exports/:type`.

## 10. Critérios de aceite

- modelo oficial;
- validação por linha;
- nenhuma gravação na prévia;
- impacto antes da confirmação;
- importação transacional;
- exportação compatível com Excel;
- textos e datas em pt-BR.
