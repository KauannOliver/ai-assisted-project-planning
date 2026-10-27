# Módulo 10 — Prévia de Impacto e Explicabilidade

## 1. Objetivo

Comparar o cronograma atual com uma alteração proposta antes de persistir os dados.

## 2. Dependências

- Módulo 09.

## 3. Princípio

Não existem simulações independentes salvas.

Toda alteração relevante gera uma execução temporária e, ao confirmar, substitui o cronograma oficial.

## 4. Fluxo

```text
1. Usuário envia alteração proposta.
2. API valida permissão e formato.
3. Estado atual é carregado.
4. Alteração é aplicada em contexto temporário.
5. Motor calcula cenário proposto.
6. Comparador gera impacto.
7. API retorna modal e token da proposta.
8. Usuário confirma ou cancela.
9. Ao confirmar, validar que a base não mudou.
10. Persistir alteração, cronograma e evento na mesma transação.
```

## 5. Concorrência

A proposta deve conter:

- hash ou versão dos dados-base;
- horário;
- usuário;
- expiração curta.

Se os dados mudarem, exigir nova prévia.

## 6. Alterações que exigem prévia

- projeto elegível criado;
- status;
- classe;
- requisito legal;
- decisão;
- nota;
- prioridade de negócio;
- fila;
- modo manual/automático;
- recurso por fase;
- modo simultâneo/sequencial;
- ordem de recursos;
- capacidade;
- indisponibilidade;
- percentuais;
- parâmetros;
- cancelamento;
- reativação;
- prazo, quando muda classificação de risco;
- importação em massa.

## 7. Resumo do modal

- data final anterior;
- data final proposta;
- diferença em dias úteis;
- projetos antecipados;
- projetos postergados;
- novos atrasos;
- atrasos resolvidos;
- recursos mais afetados;
- causas principais;
- oito projetos destacados.

## 8. Regra dos oito projetos

- somente postergados: oito maiores;
- somente antecipados: oito maiores;
- ambos: quatro de cada, quando possível.

## 9. Detalhamento completo

Tabela com:

- SD;
- título;
- data anterior;
- nova data;
- diferença;
- status de risco anterior;
- novo status de risco;
- causas;
- recursos envolvidos.

## 10. Explicações

As causas devem ser produzidas pelo motor.

Tipos iniciais:

- indisponibilidade;
- mudança de prioridade;
- requisito legal;
- decisão do comitê;
- troca de status;
- mudança de classe;
- troca de recurso;
- mudança de execução;
- redução de capacidade;
- conflito de recurso;
- liberação antecipada;
- retirada de projeto;
- fase sem recurso.

## 11. Cadeia causal

Cada efeito pode referenciar sua causa anterior.

Exemplo:

```text
Férias de João
→ Desenvolvimento da SD 123 postergado
→ Qualidade começou depois
→ Maria entrou em conflito com a SD 456
→ SD 456 postergada em dois dias
```

## 12. Persistência

Não armazenar a simulação completa anterior.

Registrar apenas evento resumido:

- alteração;
- usuário;
- horário;
- diferença da carteira;
- principais projetos;
- causa principal.

## 13. APIs sugeridas

Padrão genérico:

- `POST /changes/:type/preview`;
- `POST /changes/:previewId/confirm`;
- `DELETE /changes/:previewId`.

Também podem existir endpoints específicos por módulo.

## 14. Critérios de aceite

- nenhuma mudança relevante salva sem prévia;
- cancelar não altera dados;
- confirmar salva dados e cronograma atomicamente;
- prévia inválida se base mudou;
- resumo de oito projetos;
- detalhamento completo;
- explicação determinística;
- cadeia causal disponível.
