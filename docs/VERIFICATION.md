# Snapshot verification

Checks recorded in the isolated source copy on 2026-10-28. These results are not a production certification.

| Directory | Command | Result |
| --- | --- | --- |
| `.` | `npm ci --ignore-scripts --no-audit --no-fund` | Passed |
| `.` | `npx prisma generate --schema packages/database/prisma/schema.prisma` | Passed |
| `.` | `npm test` | Passed |
| `.` | `npm run build` | Passed |

The 99 API unit tests and workspace production builds passed. Prisma generation was local only; no migration, seed, corporate database or live AI call was executed.

## Publication boundaries

- Operational sources remained read-only; only isolated copies were prepared.
- No corporate service, real-record import, live notification or production database was invoked.
- No deployment command, deploy workflow or new hosting integration is part of this update. Included Vercel configurations disable Git-driven deployments.
- New source imports exclude local environments, databases, generated outputs and operational documents.
- Existing Git history is preserved. Historical public names or assets may remain in old commits; current snapshots use neutral public presentation.

## Production npm dependency audit — ai-assisted-project-planning

`npm audit --omit=dev --json` reported 2 critical, 10 high, 8 moderate, 0 low findings in the installed dependency tree on 2026-10-28. Counts include transitive packages and do not establish exploitability in this application.

| Package | Severity | Direct dependency |
| --- | --- | --- |
| `@nestjs/common` | moderate | Yes |
| `@nestjs/config` | moderate | Yes |
| `@nestjs/core` | moderate | Yes |
| `@nestjs/platform-express` | high | Yes |
| `@nestjs/swagger` | moderate | Yes |
| `body-parser` | high | No |
| `brace-expansion` | high | No |
| `exceljs` | moderate | Yes |
| `file-type` | moderate | No |
| `js-yaml` | high | No |
| `lodash` | high | No |
| `multer` | high | No |
| `nanoid` | high | No |
| `next` | critical | Yes |
| `postcss` | high | No |
| `proxy-addr` | critical | No |
| `qs` | moderate | No |
| `source-map-js` | high | No |
| `uuid` | moderate | No |
| `zod` | high | Yes |

These advisories remain a maintenance item. This documentation/publication task did not perform dependency upgrades or validate a production security posture.
