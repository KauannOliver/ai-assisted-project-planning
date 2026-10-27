# Módulo 04 — Recursos, Capacidade e Indisponibilidades

## 1. Objetivo

Cadastrar recursos técnicos, calcular capacidade líquida e impedir alocação durante indisponibilidades.

## 2. Dependências

- Módulo 01;
- Módulo 03.

## 3. Entidade Resource

Campos:

- id;
- nome;
- modalidade;
- cargo;
- horas semanais;
- percentual de overhead;
- percentual de desenvolvimento;
- limite recomendado de projetos simultâneos;
- status.

Valor padrão do limite de projetos: 3.

## 4. Fórmula de capacidade

```text
horasApósOverhead =
horasSemanais × (1 - overheadPercentual)

capacidadeSemanalProjetos =
horasApósOverhead × desenvolvimentoPercentual

capacidadeDiaria =
capacidadeSemanalProjetos ÷ 5
```

Exemplo:

```text
Horas semanais: 44h
Overhead: 10%
Desenvolvimento: 70%

44 × 0,90 = 39,6h
39,6 × 0,70 = 27,72h
27,72 ÷ 5 = 5,544h por dia
```

A interface deve mostrar horas e minutos.

## 5. Interpretação dos percentuais

- overhead representa tempo não produtivo geral;
- desenvolvimento representa a parcela das horas restantes dedicada a projetos;
- o restante do percentual de desenvolvimento representa sustentação e suporte.

Não é obrigatório que overhead e desenvolvimento somem 100%, pois são aplicados em etapas diferentes.

## 6. WIP

- o recurso pode trabalhar em vários projetos no mesmo dia;
- o limite conta projetos distintos;
- ultrapassar o limite gera alerta;
- o limite não bloqueia o motor.

## 7. Entidade ResourceUnavailability

Campos:

- id;
- tipo;
- data inicial;
- data final;
- minutos indisponíveis por dia, quando parcial;
- resourceId, quando individual;
- global;
- recorrência anual;
- observação;
- status.

## 8. Tipos

- Feriado;
- Férias;
- Atestado;
- Treinamento;
- Licença;
- Outro.

Regras:

- feriado é global;
- feriado pode repetir anualmente;
- Outro pode ser global ou individual;
- todos os tipos reduzem capacidade;
- indisponibilidade parcial é permitida;
- não há redução temporária de capacidade fora desse cadastro.

## 9. Calendário

A tela deve exibir:

- visão mensal;
- nomes dos recursos indisponíveis em cada dia;
- indicação de indisponibilidade global;
- filtros por recurso e tipo;
- detalhe por clique.

## 10. Impacto no motor

Criar, editar ou remover indisponibilidade relevante exige:

1. cálculo proposto;
2. comparação;
3. modal de impacto;
4. confirmação;
5. persistência atômica.

## 11. APIs sugeridas

- `GET /resources`;
- `POST /resources`;
- `GET /resources/:id`;
- `PATCH /resources/:id`;
- `POST /resources/:id/activate`;
- `POST /resources/:id/deactivate`;
- `GET /unavailabilities`;
- `POST /unavailabilities/preview`;
- `POST /unavailabilities/confirm`;
- `PATCH /unavailabilities/:id/preview`;
- `PATCH /unavailabilities/:id/confirm`;
- `DELETE /unavailabilities/:id/preview`;
- `DELETE /unavailabilities/:id/confirm`;
- `GET /capacity/weekly`.

## 12. Critérios de aceite

- capacidade calculada conforme fórmula;
- apresentação em horas e minutos;
- feriado reduz todos os recursos;
- indisponibilidade parcial reduz somente os minutos cadastrados;
- motor não aloca em indisponibilidade;
- sobrecarga de WIP gera alerta sem bloquear;
- calendário exibe múltiplos recursos no mesmo dia.
