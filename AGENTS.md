# AGENTS.md: Overseerr server (Ryan's fork)

Fork of `sct/overseerr` (`origin` = hiryanbautista/overseerr, `upstream` = sct/overseerr). Working branch: `develop`.
It backs the iOS app at `../../../App/Overseerr` (bundle `io.ryanbautista.Overseerr`). The main custom addition is native iOS push notifications over APNs.

## Hard rules

- **Never merge or rebase `upstream` unless Ryan explicitly asks.** `git fetch upstream` is fine.
- **Don't commit or push unless asked.**
- **PR-only for `develop` on origin.** A push to `origin/develop` runs `.github/workflows/docker-image.yml`. That workflow builds and pushes `ryanbautista97/overseerr-ios:latest` and `:v1.0.<N>` to Docker Hub, then bumps the `OVERSEERR_MINOR` repo variable. Anything pulling `:latest` gets the new image. Put changes on a branch and open a PR. Never push straight to `develop`. All other workflows are disabled on the fork.
- Never change a migration that has already shipped. Add a new one instead (see the warning under Migrations).
- Don't touch `config/` (local settings.json and the dev SQLite DB). It's gitignored.

## Commands

`yarn` (v1) is **not on PATH** on this Mac (Node v22.15.0 via nvm). Use `corepack enable`, `npx yarn@1`, or call the binaries in `node_modules/.bin` directly.

| Task                             | Command                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev server (API + Next on :5055) | `yarn dev`                                                                                                                                    |
| Typecheck server                 | `yarn typecheck:server`, or `./node_modules/.bin/tsc --project server/tsconfig.json --noEmit` (passes, ~5s)                                   |
| Typecheck client                 | `yarn typecheck:client`, or `./node_modules/.bin/tsc --noEmit` (**fails**: `ua-parser-js` is missing from node_modules and needs a reinstall) |
| Lint                             | `yarn lint` (server: 0 errors, 6 warnings)                                                                                                    |
| Format                           | `yarn format` / `yarn format:check`                                                                                                           |
| Build                            | `yarn build` (Next, then server, into `dist/`)                                                                                                |
| Prod start                       | `yarn start` (`node dist/index.js`)                                                                                                           |

Docker images use Node 18.18.2 (`Dockerfile`). Local Node is 22. Native modules (sqlite3, bcrypt) load on 22.

## Layout

- `server/`: Express API. Routes in `server/routes/`, entities in `server/entity/`, migrations in `server/migration/`, subscribers in `server/subscriber/`, notification agents in `server/lib/notifications/agents/`, settings model in `server/lib/settings.ts`.
- `src/`: Next.js web UI.
- `overseerr-api.yml`: OpenAPI spec. `express-openapi-validator` checks requests against it, so **every new or changed endpoint or body field must be added here** or requests get rejected.
- Custom fork code: `server/lib/notifications/agents/ios.ts`, `server/migration/1694811143681-AddAPNSiOS.ts`, `iOSDeviceToken` on `UserSettings`, and `/settings/notifications/ios*` routes.

## Migrations (TypeORM, SQLite)

- DataSource: `server/datasource.ts`. Dev uses `synchronize: true` (the schema auto-syncs from entities, so a missing migration won't show up in dev). Prod uses `synchronize: false` and runs migrations from `dist/migration`.
- Generate after changing an entity: `yarn migration:generate server/migration/<Name>`. Create an empty one: `yarn migration:create server/migration/<Name>`. Run: `yarn migration:run`.
- SQLite migrations rebuild the whole table (`temporary_<table>` → copy → drop → rename). **Any later migration that rebuilds `user_settings` must list `iOSDeviceToken`.** On `develop`, upstream's `1697393491630-AddUserPushoverSound` rebuilds `user_settings` without it, so on a prod DB it drops the column. The local `letterbox` branch has a fix, but it edits the shipped migration. Don't copy that approach. Check this whenever upstream migrations come in.

## Running and deploying

- Container image `ryanbautista97/overseerr-ios`, built by GitHub Actions on push to `develop`. Port 5055. Config lives in `/app/config` (`settings.json` plus `db/db.sqlite3`), and `CONFIG_DIRECTORY` overrides it.
- iOS push needs the env vars `APNS_KEY` (p8 key body; `\n` gets unescaped) and `APNS_ENV=prod` for production APNs (any other value means sandbox). Key ID and Team ID are hardcoded in `ios.ts`.
- The host it runs on (Unraid or something else) isn't recorded in the repo. Ask Ryan.
- `docker-compose.yml` / `Dockerfile.local` are a dev container (`yarn dev`), not prod.

## Orchestrator context sync

- After a direct task that changes API endpoints, entities/migrations, auth, conventions, or deployment, `t3_thread_send` the orchestrator (thread 22b9b0da-e70b-4886-8441-ab5aa773f00e) a replacement for the affected sections of `context/server-context.md`.
- When the orchestrator asks for changes since your last context update, reply with them or "none".
