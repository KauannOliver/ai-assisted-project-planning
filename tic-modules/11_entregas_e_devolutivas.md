# Módulo 11 — Entregas e Devolutivas

## 1. Objetivo

Registrar o que foi entregue pelo TI e quando a área devolveu uma resposta.

## 2. Dependências

- Módulo 05.

## 3. Regra central

Entregas e devolutivas não impactam o motor.

São registros de acompanhamento e comunicação.

## 4. Entidade Delivery

- id;
- projectId;
- data da entrega;
- observação;
- criado por;
- criado em.

## 5. Entidade DeliveryFeedback

- id;
- deliveryId;
- data da devolutiva;
- observação;
- criado por;
- criado em.

Cada entrega deve possuir no máximo uma devolutiva.

## 6. Pendência

Entrega sem devolutiva:

- status Pendente;
- mostrar dias corridos aguardando;
- aparecer nos alertas.

## 7. Múltiplas entregas

- projeto pode ter várias;
- várias podem estar pendentes ao mesmo tempo;
- não existe conceito de entrega parcial;
- entrega é sempre um ponto independente.

## 8. Indicadores

Por departamento:

- total de entregas;
- total com devolutiva;
- total pendente;
- tempo médio de resposta;
- menor tempo;
- maior tempo.

Quando projeto atende vários departamentos, o indicador deverá definir uma regra consistente.

Recomendação:

- atribuir a entrega a um departamento destinatário obrigatório;
- sem esse campo, a mesma entrega seria duplicada em vários indicadores.

## 9. Telas

- aba de entregas no projeto;
- lista global de pendências;
- cadastro de entrega;
- cadastro de devolutiva;
- indicador por departamento.

## 10. APIs sugeridas

- `GET /projects/:id/deliveries`;
- `POST /projects/:id/deliveries`;
- `PATCH /deliveries/:id`;
- `DELETE /deliveries/:id`;
- `POST /deliveries/:id/feedback`;
- `PATCH /deliveries/:id/feedback`;
- `GET /deliveries/pending`;
- `GET /deliveries/metrics`.

## 11. Critérios de aceite

- várias entregas por projeto;
- uma devolutiva por entrega;
- dias aguardando;
- pendência visível;
- nenhum efeito no cronograma;
- média por departamento;
- histórico de criação.
