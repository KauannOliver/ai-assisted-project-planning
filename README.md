# TIC — Gestão de Projetos

Aplicação para gestão e acompanhamento de portfólio de tecnologia, com cadastro de projetos e recursos, governança de comitê, priorização e simulação de cronograma por capacidade.

## Componentes

- **Web:** Next.js 14 e React 18; interface em `apps/web`.
- **API:** NestJS, TypeScript e Prisma em `apps/api`; inclui motor de cronograma, importação/exportação de planilhas e API de BI.
- **Dados:** PostgreSQL, schema e migrações em `packages/database/prisma`.
- **Worker:** BullMQ e Redis em `apps/worker`. O processador atual é um placeholder; o cálculo do cronograma está na API.
- **Infraestrutura:** Docker Compose com PostgreSQL, Redis, API, web e worker.

## Começar com Docker

Requisitos: Docker com Compose. O projeto usa Node.js 20 nas imagens. As portas padrão no host são 3100 (web), 4100 (API), 55432 (PostgreSQL) e 56379 (Redis).

1. Copie `.env.example` para `.env` e configure `POSTGRES_PASSWORD`, `DATABASE_URL` e um `JWT_SECRET` longo e aleatório. As senhas em `DATABASE_URL` e `POSTGRES_PASSWORD` devem coincidir. Ajuste `CORS_ORIGINS` para os endereços usados.
2. Execute `docker compose up --build -d`. A API aplica as migrações na inicialização.
3. Acesse `http://localhost:3100` e a documentação Swagger em `http://localhost:4100/api/docs`. Os endpoints de saúde são `/health` e `/ready` na API.

O banco de um clone novo começa sem usuários. **Não há seed seguro incluído:** o seed operacional da cópia original foi excluído do repositório por conter dados internos, credenciais fixas e limpeza de dados. Portanto, o primeiro acesso exige um procedimento seguro de provisionamento de usuário antes de a aplicação ser utilizável. Não execute seeds desconhecidos sobre dados existentes.

## Desenvolvimento local

Com Node.js 20, npm, PostgreSQL e Redis disponíveis, configure `.env` a partir do exemplo, instale com `npm ci` e gere o cliente com `npx prisma generate --schema packages/database/prisma/schema.prisma`. Para um banco de desenvolvimento vazio, aplique as migrações com `npx prisma migrate deploy --schema packages/database/prisma/schema.prisma`; confira o destino antes de executar qualquer comando de banco.

Execute os serviços em terminais separados: `npm run dev:api`, `npm run dev:web` e `npm run dev:worker`. A API usa `PORT` (4100 no exemplo); o frontend encaminha `/backend-api` para `INTERNAL_API_URL` ou `http://localhost:4100`. Para alterar as portas do PostgreSQL e Redis no host, atualize também `DATABASE_URL` e `REDIS_URL`.

```bash
npm test       # testes dos workspaces que possuem script de teste
npm run build  # builds dos workspaces que possuem script de build
```

`npm run db:migrate` executa `prisma migrate dev`, destinado ao desenvolvimento. `npm run db:seed` depende do seed operacional não incluído; `npm run db:studio` consta no manifesto raiz, mas não possui script correspondente no workspace do banco.

## Configuração

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL para execução local e ferramentas Prisma. |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL no Compose. |
| `REDIS_URL` | Conexão Redis para execução local. |
| `JWT_SECRET` | Assinatura dos tokens de sessão; mantenha secreto. |
| `CORS_ORIGINS` | Origens permitidas, separadas por vírgulas. |
| `API_HOST_PORT`, `WEB_HOST_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT` | Portas publicadas pelo Compose. |
| `PORT` | Porta da API local; no container é definida como 4000. |
| `INTERNAL_API_URL` | Destino do proxy do Next.js. |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS` | Narrativas opcionais; sem chave, há resposta local de fallback. |
| `BI_API_KEY` | Chave exclusiva para endpoints de leitura `/bi/v1`, enviada em `X-API-Key`. |
| `NEXT_PUBLIC_API_URL` | Campo presente no exemplo; a interface usa o proxy `/backend-api`. |

Os valores padrão e exemplos destinam-se a desenvolvimento. Revise segredos, exposição de portas, permissões e política de acesso antes de qualquer implantação.

## Documentação e estrutura

- [Guia técnico](docs/guia-tecnico.md): organização, fluxos, testes e cuidados operacionais.
- [Especificações modulares](tic-modules/README.md): documentos de requisitos e planos; não representam necessariamente funcionalidades entregues.
- [Especificação histórica](DOC.md) e [descrição do motor](MOTOR.md): material de referência que pode conter afirmações ou portas antigas; prevalecem o código e este README para execução.
- `scripts/`: ferramentas de auditoria e reconciliação; algumas alteram dados. Leia o código e use somente em ambiente adequado.

Backups, saídas de auditoria, ambientes, seed operacional e relatórios de operação permanecem fora do Git. O repositório não inclui uma licença de distribuição; confirme os direitos e a autorização antes de compartilhar o código.
