# Módulo 01 — Fundação, Arquitetura e Segurança

## 1. Objetivo

Criar a base técnica do sistema, incluindo estrutura do monorepo, autenticação, persistência, contratos, tratamento de erros e padrões de desenvolvimento.

## 2. Dependências

Nenhuma dependência funcional.

## 3. Stack

### Frontend

- Next.js;
- TypeScript;
- Tailwind CSS;
- componentes padronizados;
- TanStack Query;
- React Hook Form;
- Zod.

### Backend

- NestJS;
- TypeScript;
- API REST;
- OpenAPI;
- validação de entrada;
- módulos por domínio.

### Persistência

- PostgreSQL;
- Prisma ORM;
- migrations versionadas;
- transações.

### Processamento

- Redis;
- BullMQ;
- worker dedicado ao motor.

### Testes

- Vitest ou Jest;
- Supertest;
- Playwright.

## 4. Estrutura sugerida

```text
apps/
├── web
├── api
└── worker

packages/
├── domain
├── scheduling-engine
├── contracts
├── database
├── ui
├── config
└── testing
```

## 5. Autenticação

O login será por usuário e senha.

Campos mínimos:

- nome;
- e-mail;
- senha;
- perfil;
- status;
- troca obrigatória de senha;
- tentativas inválidas;
- bloqueio temporário;
- último acesso.

### Regras

- senha armazenada com hash seguro;
- primeiro acesso exige troca;
- usuário inativo não acessa;
- limite de tentativas inválidas;
- sessão encerrada no logout;
- senha inicial definida por administrador;
- recuperação de senha realizada administrativamente.

## 6. Sessão

Recomendação:

- cookie HTTP-only;
- `Secure` em produção;
- `SameSite=Lax` ou mais restritivo;
- rotação de sessão após login;
- expiração por inatividade;
- invalidação de todas as sessões ao redefinir senha.

## 7. RBAC inicial

Perfis:

- `ADMIN`;
- `PROJECT_MANAGER`;
- `MANAGER`;
- `DIRECTOR`.

As permissões detalhadas ficam no Módulo 02.

## 8. Padrão de erros

Toda resposta de erro deverá conter:

```json
{
  "code": "PROJECT_NOT_FOUND",
  "message": "Projeto não encontrado.",
  "details": {},
  "traceId": "..."
}
```

O frontend não deve depender de textos para identificar o erro.

## 9. Identificadores

Cada entidade terá:

- ID técnico interno;
- identificadores funcionais quando aplicável.

O número da SD não substitui o ID técnico do banco.

## 10. Datas e horários

- persistir timestamps em UTC;
- datas puras em tipo de data;
- apresentar no fuso configurado;
- cálculos de dias úteis isolados em biblioteca própria.

## 11. Transações

Devem ser transacionais:

- confirmação de alteração com impacto;
- gravação de reunião e decisões;
- atualização do projeto pela decisão;
- gravação do cronograma;
- importações;
- troca do modo da fila.

## 12. APIs iniciais

- `POST /auth/login`;
- `POST /auth/logout`;
- `POST /auth/change-password`;
- `GET /auth/me`;
- `POST /auth/admin-reset-password`;
- `GET /health`;
- `GET /ready`.

## 13. Critérios de aceite

- login funcional;
- troca obrigatória de senha;
- bloqueio de usuário;
- migrations reproduzíveis;
- API documentada;
- web, API e worker executando por Docker Compose;
- tratamento de erro padronizado;
- logs com `traceId`;
- testes básicos de autenticação;
- pipeline local de lint, typecheck e testes.
