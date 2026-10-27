# Guia técnico

## Organização

`apps/web` contém páginas, componentes e o proxy Next.js. `apps/api` reúne controllers por domínio, autenticação, regras de negócio e o `EngineService`. `packages/database` mantém schema Prisma e histórico de migrações. `apps/worker` registra um consumidor BullMQ, cujo processamento é atualmente ilustrativo. `tic-modules` reúne especificações funcionais, não um inventário garantido de recursos implementados.

## Fluxos principais

A interface chama a API pelo caminho `/backend-api`; o Next.js encaminha as requisições para a API. Sessões usam cookies e autenticação JWT. A API persiste dados no PostgreSQL via Prisma. O motor na API calcula cronogramas e impactos a partir de projetos, fases, recursos, prioridades e disponibilidade. Importação e exportação de planilhas estão no domínio `imports-exports`; a consistência de esforço é centralizada em `projects/project-effort.ts`. A API de BI é de leitura e usa uma chave própria.

## Banco e segurança

As migrações estão em `packages/database/prisma/migrations`. O container da API executa `prisma migrate deploy` ao iniciar; isso altera o schema do banco apontado. Avalie backup, compatibilidade e plano de reversão antes de aplicar migrações em qualquer ambiente com dados. O repositório não fornece seed seguro nem usuário inicial; o seed local original tem exclusões de dados e não deve ser executado em uma base existente.

Arquivos `.env`, backups, dados de operação e exportações devem permanecer fora do histórico. A API possui senhas provisórias no fluxo de criação de usuários; avalie a política de primeiro acesso e a segurança dos ambientes antes de utilizá-la. A integração Groq é opcional e pode transmitir informações da análise para um serviço externo quando habilitada; configure-a conforme as regras de dados da organização.

## Verificação

Os testes automatizados estão em `apps/api/src/common/tests` e `apps/api/test`, executados com Vitest pelo comando `npm test`. O build da raiz percorre os workspaces com script de build. Testes e compilação não substituem validação de login, migrações e fluxos completos em um ambiente isolado. Scripts de reconciliação/importação podem gravar no banco: inspecione-os antes de usá-los e nunca aponte uma validação para uma base ativa sem um plano adequado.
