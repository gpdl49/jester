# Jester

A curation dashboard for the memes buried in Immich. It finds them in 15 years
of photos, moves them out of Immich into S3, tags them with AI, looks for the
original creator, and posts them to an Instagram creator account on a schedule.

## Decisions

| Area | Decision |
|------|----------|
| Code | Private repo [`gpdl49/jester`](https://github.com/gpdl49/jester), submodule at `projects/jester` (first-party, no `branch =` line). Foundation copied from Wardrobe (`lib/http`, `lib/auth`, `lib/jobs`, `lib/s3`, test helpers, CI, Dockerfile). |
| Stack | Next.js 16 (App Router, standalone output), TypeScript, Prisma 7 + `@prisma/adapter-pg`, Tailwind 4, Radix, TanStack Query, zod 4, sharp; Node 24, pnpm. Vitest for unit tests and Postgres-backed integration tests; MinIO for S3 in tests. |
| Hosting | Centerpoint, namespace `jester-system`. One image, two Deployments: `jester` (web, `JOBS_ENABLED=false`) and `jester-worker` (same image, `JOBS_ENABLED=true`, no Service), so long imports never slow down the dashboard. |
| Auth | oauth2-proxy sidecar with Zitadel OIDC, exactly as in Wardrobe. Role `jester` lets a user in (curate, schedule). Role `jester-admin` can also connect Instagram accounts, change settings and budgets, and purge. One shared library, not per-user; every write records its actor. |
| Database | CNPG `jester-pg`, backed up to S3 like the other CNPG clusters. pg-boss jobs on the same database. Postgres full-text search on OCR text, description and tags. |
| Storage | S3 bucket `centerpoint-jester-media` (eu-central-1), **versioned** because the Immich copy is deleted permanently. Noncurrent versions expire after 90 days. |
| Finding memes | Every Immich image is scored with free signals (filename, MIME type, missing camera EXIF, screenshot dimensions, Immich CLIP smart-search hits, Immich OCR text). Candidates over a threshold go to a cheap vision triage model on Immich's preview thumbnail. You confirm or reject them in a review queue. Auto-accept above a threshold exists but is **off** by default. |
| Moving out of Immich | An accepted asset's original is downloaded, its SHA-1 checked against Immich's checksum, and it is uploaded to S3 and verified with a HeadObject (size and SHA-256). Only then is the asset **permanently deleted** from Immich (`DELETE /api/assets {force: true}`). Every deletion is written to an audit table. A global kill switch `IMMICH_DELETE_ENABLED` leaves the asset in Immich and records the deletion as `skipped`. |
| Ongoing sync | The worker polls Immich every 10 minutes (`updatedAfter` cursor), so screenshots that phone backup uploads to Immich go through the same pipeline. The dashboard also takes direct drag-and-drop uploads, which skip triage. |
| Analysis | An OpenRouter vision model with strict JSON-schema output returns OCR text, a description, alt text, the meme template, topics, sensitivity flags (NSFW, politics, slurs, **visible personal data** such as names or phone numbers in chat screenshots), quality flags, an era estimate, a postability score, and a caption and hashtag draft. Perceptual hash (64-bit dHash) for near-duplicate detection. |
| Attribution | Two steps. (1) Clues from the analysis: watermarks, handles, subreddit, site logos. (2) A web-search pass through OpenRouter (`plugins: [{id: "web"}]`) with the OCR text and clues. It returns ranked candidates with a source URL, evidence and confidence; you confirm one. A `ReverseImageSearchProvider` interface ships with a no-op implementation so a paid provider can be added later. |
| Instagram | Instagram API with Unified Login (Facebook Login for Business dialog; `graph.facebook.com`; Business Integration System User token; permissions `instagram_basic` and `instagram_content_publish`; no Facebook Page, but a business portfolio). Single images and carousels of up to 10. A per-post JPEG rendition at 1080 px wide, padded to a ratio between 4:5 and 1.91:1, is served by a presigned S3 URL. A scheduler fills posting slots from the approved queue. The app enforces `content_publishing_limit` itself. |
| AI budget | Every OpenRouter call is recorded in `AiUsage` with its cost. A daily budget (`AI_DAILY_BUDGET_USD`, default 3) pauses AI jobs until the next UTC day; the OpenRouter key has a monthly hard limit. |
| CI | In the jester repo: lint, typecheck and tests on `ubuntu-latest`; the image is built with buildah, also on GitHub-hosted runners (the repo is public; the self-hosted ARC runners serve private repos only), and published as `ghcr.io/gpdl49/jester:main`, then rolled out by Flux image automation on Sinkhole. |

### Rough cost

Triage is about $0.0004 per candidate (Gemini Flash-Lite on a 1440 px preview), so 30,000 candidates cost about $12 once. Analysis is about $0.003 and attribution about $0.03 per meme (a web search costs $0.014). With 3,000 memes the backfill is roughly $110 in total, spread over days by the daily budget. Attribution runs on demand or as a batch for approved memes only.

## Interfaces (build contract)

Every component is built against this section. Change it here first.

### Names

| Thing | Value |
|-------|-------|
| Public host | `jester.vidur.xyz`, Centerpoint gateway listener `https-wildcard-vidur-xyz` |
| Namespace | `jester-system` (Centerpoint) |
| Image | `ghcr.io/gpdl49/jester`, tags `main` and `main-<sha>` (private; pulled with `ghcr-login`) |
| Image policy | `flux-system:jester` on Sinkhole, filter `^main$`, digest reflection |
| Deployments | `jester` (web + oauth2-proxy sidecar, Service `jester` on port `4180` only) and `jester-worker` (no sidecar, no Service) |
| App container | `127.0.0.1:3000`, UID 65532, read-only root; writable `/tmp` (emptyDir, 2 GiB) and `/app/.next/cache` |
| Health | `GET /api/healthz` → 200 `ok`; oauth2-proxy `SKIP_AUTH_ROUTES=GET=^/api/healthz$`. The worker's probe is `exec: node -e "fetch('http://127.0.0.1:3000/api/healthz')…"` |
| Database | CNPG `jester-pg`, database `jester`, owner `jester`; secret `jester-pg-app` (`uri`) |
| Zitadel roles | `jester`, `jester-admin` (project `homestacks`) |
| Zitadel app | `jester`, OIDC web, code flow + PKCE, basic auth, redirect `https://jester.vidur.xyz/oauth2/callback`, userinfo in ID token |
| AWS region | `eu-central-1` |
| Bucket | `centerpoint-jester-media`: private, SSE-S3, owner-enforced, versioning on, noncurrent expiry 90 days, abort incomplete multipart after 1 day, CORS `PUT`/`GET`/`HEAD` from `https://jester.vidur.xyz` and `http://localhost:3000` exposing `ETag` |
| IAM user | `centerpoint-jester`: `s3:GetObject`, `PutObject`, `DeleteObject`, `AbortMultipartUpload` on `media/*`, `ig/*` and `uploads/*`; `s3:ListBucket` |
| OpenRouter key | `openrouter_api_key.jester_centerpoint` in `terraform/openrouter`, limit $40 monthly; output `jester_centerpoint_api_key` |
| Immich | `https://immich.vidur.xyz/api`, an API key created by hand in Immich (Account settings → API keys) with permissions `asset.read`, `asset.view`, `asset.download`, `asset.delete` |
| Instagram | Meta app created by hand (use case "Manage messaging and content on Instagram", API setup with Unified Login, a login configuration with the permissions), redirect `https://jester.vidur.xyz/api/instagram/callback` |

### Object keys

```
media/<memeId>/original.<ext>    # exact bytes from Immich or the upload (jpg|png|webp|gif|heic)
media/<memeId>/display.webp      # longest edge 1600 px, EXIF stripped, orientation applied
media/<memeId>/thumb.webp        # longest edge 400 px
uploads/<uploadId>               # direct-upload staging, deleted after import (abort/expire after 1 day)
ig/<postId>/<position>.jpg       # Instagram rendition: sRGB JPEG q90, width 1080, ratio clamped to [4:5, 1.91:1] by padding
```

HEIC originals are stored as they are; renditions use Immich's `fullsize` JPEG when the source is HEIC (sharp has no HEVC decoder). Direct uploads reject HEIC with 422 `unsupported_format`.

### Secrets in `jester-system`

| Secret | Keys | Source |
|--------|------|--------|
| `jester-aws` | `access_key_id`, `secret_access_key` | Crossplane AccessKey on Sinkhole (`clusters/sinkhole/jester-aws/`) → PushSecret `centerpoint-jester-aws` |
| `jester-oidc` | `client_id`, `client_secret` | Crossplane Zitadel `Oidc` `jester` → PushSecret `centerpoint-jester-oidc` |
| `jester-openrouter` | `api_key` | tofu-controller `openrouter` outputs → PushSecret `centerpoint-jester-openrouter` |
| `jester-oauth2-proxy-cookie` | `cookie-secret` | SOPS |
| `jester-app` | `token_encryption_key` (32 random bytes, base64) | SOPS |
| `jester-immich` | `api_key` | SOPS, added by hand after creating the key in Immich (`optional: true` until then) |
| `jester-instagram` | `app_id`, `app_secret`, `config_id` | SOPS, added by hand after creating the Meta app and its login configuration. `app_id` and `app_secret` are the **Meta** app's, not an Instagram app's (`optional: true` until then) |
| `ghcr-login` | `.dockerconfigjson` | SOPS (same value as Wardrobe's) |
| `jester-pg-app` | CNPG-generated | CNPG |

### App environment

```
HOSTNAME=127.0.0.1  PORT=3000  NODE_ENV=production
DATABASE_URL                      # jester-pg-app/uri
JOBS_ENABLED=true|false           # worker Deployment true, web false
AUTH_MODE=proxy|dev               # dev refused when NODE_ENV=production
REQUIRED_GROUP=jester  ADMIN_GROUP=jester-admin
PUBLIC_URL=https://jester.vidur.xyz
AWS_REGION=eu-central-1  AWS_ACCESS_KEY_ID  AWS_SECRET_ACCESS_KEY
MEDIA_BUCKET=centerpoint-jester-media
S3_ENDPOINT                       # optional (MinIO, path-style)
TOKEN_ENCRYPTION_KEY              # base64, 32 bytes; AES-256-GCM for Instagram tokens
OPENROUTER_API_KEY                # optional: AI features off without it
OPENROUTER_TRIAGE_MODEL=google/gemini-3.5-flash-lite
OPENROUTER_ANALYSIS_MODEL=google/gemini-3.8-flash
OPENROUTER_ATTRIBUTION_MODEL=google/gemini-3.8-flash
AI_DAILY_BUDGET_USD=3
IMMICH_URL=https://immich.vidur.xyz  IMMICH_API_KEY   # optional: sync off without it
IMMICH_DELETE_ENABLED=true|false  # default false; true in production
IMMICH_SYNC_INTERVAL_MINUTES=10
INSTAGRAM_APP_ID  INSTAGRAM_APP_SECRET  INSTAGRAM_CONFIG_ID  # Meta app id and secret, login configuration id; optional: publishing off without them (and TOKEN_ENCRYPTION_KEY)
INSTAGRAM_GRAPH_VERSION=v27.0
SCHEDULE_TIMEZONE=Asia/Kolkata
```

Runtime settings that admins change in the UI (thresholds, smart-search queries, schedule slots, auto-accept) live in the `Setting` table, with env values as defaults.

### Authentication

As in Wardrobe (`docs/wardrobe.md#authentication`), with `OAUTH2_PROXY_ALLOWED_GROUPS=jester`. The app reads `X-Forwarded-User`, `-Email`, `-Preferred-Username` and `-Groups`. A missing user gives 401; without `REQUIRED_GROUP` the response is 403. The app upserts a `User` row on each sign-in. Admin-only routes give 403 to non-admins.

### Pipeline and states

```
Immich asset ──scan──▶ ImmichAsset(prefilter score)
   │ score ≥ PREFILTER_THRESHOLD (0.35)
   ▼
 triage.classify ──▶ triageStatus: pending → scored (memeProbability)
   │ user accepts (or auto-accept ≥ AUTO_ACCEPT_THRESHOLD, off by default)
   ▼
 import.immich ──▶ Meme(status inbox) + renditions + dHash
   │ verified copy in S3
   ▼
 immich.delete (force) ──▶ ImmichDeletion(done|skipped|failed)
 analysis.meme ──▶ Analysis → Meme fields, tags
 attribution.find (on demand / batch) ──▶ AttributionCandidate[]
 user: inbox → approved | rejected ; approved → Post(draft→queued) ; scheduler → publishing → published|failed
```

`ImmichAsset.triageStatus`: `unscored` (below the prefilter) · `pending` (queued for triage) · `scored` · `accepted` · `rejected` · `imported` · `deleted` · `error`. A rejected asset is never offered again unless an admin resets it.

Prefilter score (`lib/immich/prefilter.ts`, pure, 0–1): +0.30 when the MIME type is PNG, WebP or GIF; +0.25 when the filename matches `/screenshot|screen shot|^IMG_\d+\.PNG$|received_|FB_IMG|-WA\d+|reddit|9gag|ifunny|meme/i`; +0.15 when EXIF has no camera make or model; +0.10 when the dimensions match a phone screen (aspect ≥ 1.9 portrait) or a square; +0.30 when the asset is in the top results of any smart-search query; +0.15 when Immich OCR text has ≥ 5 words. Capped at 1.

Duplicates: an import whose SHA-256 equals an existing meme's (or whose dHash is within Hamming distance 6) is linked as `duplicateOfId`, keeps `status: inbox`, and is shown for resolution. Its Immich asset is still deleted, because the bytes are already safe in S3.

### Data model (Prisma, `prisma/schema.prisma` in the app repo is authoritative)

- `User`: `id`, `sub` unique, `email`, `username`, timestamps.
- `Setting`: `key` (PK), `value` JSON, `updatedById`, `updatedAt`.
- `ImmichAsset`: `id`, `immichId` unique, `checksum` (Immich base64 SHA-1), `originalFileName`, `mimeType`, `width`, `height`, `fileCreatedAt`, `cameraMake`, `cameraModel`, `ocrText`, `prefilterScore`, `prefilterSignals` JSON, `smartHits` string[], `triageStatus`, `memeProbability`, `triageModel`, `triageResult` JSON, `decidedById`, `decidedAt`, `memeId` (unique, nullable), `error`, timestamps. Indexes on (`triageStatus`, `memeProbability`), (`prefilterScore`).
- `SyncState`: `id` (`immich`), `cursor` (updatedAfter ISO, incremental), `backfillCursor` (last `fileCreatedAt` read by the keyset backfill), `backfillStartedAt`, `backfillPage` (pages read, progress only), `backfillDone`, `smartDone`, `lastRunAt`, `lastError`.
- `Meme`: `id`, `source` (`immich` | `upload`), `status` (`inbox` | `approved` | `rejected` | `archived`), `contentType`, `size`, `width`, `height`, `sha256` unique, `dhash` (bigint, as a 16-hex string), `blurhash`, `takenAt`, `ocrText`, `description`, `altText`, `template`, `language`, `era`, `postability` (0–100), `captionDraft`, `hashtags` string[], `sensitivity` JSON `{nsfw, politics, slurs, personalData, notes}`, `quality` JSON `{lowRes, heavyCompression, cropped, watermark}`, `rating` (1–5, nullable), `notes`, `duplicateOfId`, `attributionId` (the confirmed candidate), `creditText`, `renditionsReady` bool, `userEdited` string[] (AI fields the user has changed), `search` (tsvector, generated column), timestamps, `approvedById`, `approvedAt`.
- `Tag`: `id`, `name` unique (lowercase slug), `kind` (`topic` | `template` | `style` | `user`). `MemeTag`: (`memeId`, `tagId`) PK, `source` (`ai` | `user`).
- `Analysis`: `id`, `memeId`, `kind` (`triage` | `meme` | `attribution`), `model`, `status` (`queued` | `running` | `done` | `failed`), `result` JSON, `error`, `costUsd`, timestamps.
- `AttributionCandidate`: `id`, `memeId`, `analysisId`, `creatorName`, `handle`, `platform` (`instagram` | `x` | `reddit` | `tiktok` | `tumblr` | `ninegag` | `ifunny` | `web` | `other`), `url`, `evidence`, `confidence` (0–1), `rank`, `confirmedById`, `confirmedAt`, `rejectedAt`.
- `Upload`: `id`, `uploaderId`, `contentType`, `size`, `status` (`pending` | `complete` | `imported` | `failed`), `memeId`, timestamps.
- `ImmichDeletion`: `id`, `immichAssetId`, `immichId`, `memeId`, `status` (`pending` | `done` | `skipped` | `failed`), `verifiedSha256`, `error`, `at`.
- `InstagramAccount`: `id`, `igUserId` unique, `username`, `accessTokenEnc`, `tokenExpiresAt` (null = never expires), `needsReconnect` (Meta rejected the token), `connectedById`, `isDefault`, timestamps.
- `Post`: `id`, `accountId`, `kind` (`image` | `carousel`), `status` (`draft` | `queued` | `publishing` | `published` | `failed` | `cancelled`), `caption`, `scheduledAt` (nullable: next free slot), `slotId`, `containerIds` string[], `igMediaId`, `permalink`, `publishedAt`, `attempts`, `error`, `createdById`, timestamps. `PostItem`: `postId`, `memeId`, `position` (0–9), `altText`; unique (`postId`, `position`). A meme can be in at most one non-cancelled post.
- `ScheduleSlot`: `id`, `accountId`, `weekday` (0–6, 0 = Sunday), `time` (`HH:MM` in `SCHEDULE_TIMEZONE`), `enabled`.
- `AiUsage`: `id`, `kind`, `model`, `promptTokens`, `completionTokens`, `costUsd`, `at`, `refId`.
- `AuditEvent`: `id`, `actorId` (null for the system), `action` (e.g. `meme.approve`, `immich.delete`, `post.publish`), `subjectType`, `subjectId`, `data` JSON, `at`.

### Jobs (pg-boss; `lib/jobs/definitions/<name>.ts`, all registered in `lib/jobs/registry.ts`)

| Name | Payload | Behaviour |
|------|---------|-----------|
| `immich.scan` | `{mode: "backfill" \| "incremental"}` | Cron every `IMMICH_SYNC_INTERVAL_MINUTES`. Each run first re-enqueues `import.immich` (singletonKey = asset id) for assets `accepted` over 30 minutes ago with no meme. Backfill is keyset-paged through `POST /search/metadata` (`type: IMAGE`, `withExif`, size 500, ordered by `fileCreatedAt`, `takenAfter = backfillCursor − 1 ms`, deduped by id) so deletions during the backfill never shift pages; on completion `cursor = backfillStartedAt − 5 min`. Incremental uses `updatedAfter = cursor − 5 min` (re-reads are idempotent). Runs the smart-search queries (top 250 each) once per backfill and on each incremental run limited by `createdAfter`. Upserts `ImmichAsset`, scores it, enqueues `triage.classify` for new assets over the threshold. Assets that disappear from Immich (`withDeleted`/trashed) before import get `triageStatus: error` and the note `gone`. |
| `triage.classify` | `{immichAssetId}` | Fetches `GET /assets/{id}/thumbnail?size=preview`, calls the triage model, sets `memeProbability` and `scored`, and auto-accepts above the threshold when enabled. Concurrency 4, respects the budget. A spent budget defers to the next UTC day and AI disabled/paused defers 1 hour (status stays `pending`). Never overwrites a decision made while the call ran. Retries twice on network errors only. |
| `import.immich` | `{immichAssetId}` | Downloads `/assets/{id}/original` to `/tmp` while streaming SHA-1 and SHA-256. A mismatch with `checksum` fails the job and nothing is deleted. Then PutObject with `ChecksumSHA256`, HeadObject verify (strict), create `Meme`, generate renditions, write a pending `ImmichDeletion` with the verified SHA-256, and claim the asset with a conditional `accepted → imported` update; if the asset was reset meanwhile, the new meme and its objects are rolled back. Then enqueue `analysis.meme` and `immich.delete`. A duplicate (same SHA-256) re-verifies the existing meme's S3 original before linking. Over 100 MiB → `error`. Idempotent per asset. |
| `import.upload` | `{uploadId}` | Same steps from the `uploads/` staging object; deletes the staging object at the end. |
| `immich.delete` | `{immichAssetId}` | Re-verifies with HeadObject that the S3 original exists and its SHA-256 matches, then `DELETE /assets {ids:[id], force:true}`. A 404 from Immich counts as done. Verifies against the pending `ImmichDeletion`'s SHA-256. Writes `ImmichDeletion` and an `immich.delete` `AuditEvent` for every outcome (`data.status`: done, skipped, failed). Honours `IMMICH_DELETE_ENABLED` and the `immich.deletePaused` setting. |
| `media.renditions` | `{memeId}` | display/thumb WebP, blurhash, dHash, and the duplicate check. |
| `analysis.meme` | `{memeId}` | Vision analysis on `display.webp` with a strict JSON schema; applies the fields to the `Meme` (AI fields only, never overwriting user-edited fields, tracked in `Meme.userEdited` string[]); upserts AI tags. |
| `attribution.find` | `{memeId}` | Clue prompt plus web search; stores ranked candidates. Never retries automatically. |
| `instagram.render` | `{postId}` | Builds the `ig/<postId>/<n>.jpg` renditions. |
| `instagram.publish` | `{postId}` | See Instagram below. |
| `scheduler.tick` | `{}` | Cron every minute. Re-slots queued posts more than 2 h overdue (after a pause or outage) instead of bursting them. Re-enqueues posts stuck in `publishing`. Assigns slots to queued posts without `scheduledAt` (FIFO by queue position) and enqueues `instagram.publish` for due posts (`scheduledAt ≤ now`, `status: queued`) with `singletonKey: postId` on a `stately` queue. |
| `instagram.refresh-tokens` | `{}` | Daily cron; system-user tokens are not refreshed. Checks each token with `debug_token`, keeps `tokenExpiresAt` in sync (`expires_at` 0 = null) and sets `needsReconnect` for invalid tokens. |

### HTTP API (JSON, `/api`; response types in `lib/api/types.ts`)

```
GET    /healthz                                  -> "ok"
GET    /me                                       -> {id, sub, email, username, groups[], isAdmin}
GET    /stats                                    -> DashboardStats (counts per triage status and meme status, queue length, published posts, next post, AI spend today/month, last sync)

GET    /triage?status=scored&minProbability=&cursor=&limit=  -> {items: TriageCandidate[], nextCursor}  (default sort memeProbability desc)
POST   /triage/decisions                          {decisions: {immichAssetId, decision: "accept"|"reject"}[]} -> {accepted, rejected}  (max 200)
POST   /triage/accept-above                       {minProbability} -> {accepted}  (admin)
POST   /triage/{id}/reset                         -> TriageCandidate (admin; 409 once imported or while its import job is running)
GET    /triage/{id}/preview                       -> image bytes proxied from Immich (Cache-Control private, max-age=3600)

GET    /memes?status=&tag=&template=&q=&minPostability=&sensitive=&hasAttribution=&duplicates=&sort=&cursor=&limit=
                                                 -> {items: MemeSummary[], nextCursor}  (sort: newest|oldest|postability|takenAt|rating)
GET    /memes/{id}                               -> MemeDetail (tags, analyses, attribution candidates, duplicates, posts)
PATCH  /memes/{id}                               {status?, rating?, notes?, description?, altText?, captionDraft?, hashtags?, template?, tags?, creditText?, duplicateOfId?} -> MemeDetail
POST   /memes/bulk                               {ids[], action: "approve"|"reject"|"archive"|"tag"|"untag"|"analyze"|"attribute", tag?} -> {updated}
DELETE /memes/{id}                               -> 204 (admin; 409 while in a queued/publishing/published post; cancels posts left empty, renumbers the rest, deletes the S3 objects incl. ig/ renditions)
GET    /memes/{id}/media/{variant}               -> 302 presigned GET (original|display|thumb), private, max-age=300
POST   /memes/{id}/analyses                      {kind: "meme"|"attribution"} -> 202 Analysis
POST   /memes/{id}/attribution/{candidateId}/confirm  -> MemeDetail (sets attributionId and creditText)
POST   /memes/{id}/attribution/{candidateId}/reject   -> MemeDetail
GET    /tags                                      -> {name, kind, count}[]

POST   /uploads                                  {contentType, size} -> 201 {upload, uploadUrl, uploadHeaders}  (≤ 25 MiB, jpg/png/webp/gif)
POST   /uploads/{id}/complete                    -> Upload (queues import.upload; idempotent)

GET    /instagram/accounts                       -> InstagramAccount[] (no tokens)
GET    /instagram/connect                        -> 302 to the Facebook Login for Business dialog (admin; state cookie)
GET    /instagram/callback?code&state            -> 302 /settings?instagram=connected|choose|no_accounts (exchange the code, list the reachable accounts, store encrypted)
DELETE /instagram/accounts/{id}                  -> 204 (admin)
GET    /instagram/accounts/{id}/limit            -> {used, total}

GET    /posts?status=&from=&to=&cursor=          -> {items: PostSummary[], nextCursor}
POST   /posts                                    {memeIds[1..10], caption?, accountId?, scheduledAt?, status?: "draft"|"queued"} -> 201 PostDetail (caption defaults from the template)
GET    /posts/{id}                               -> PostDetail
PATCH  /posts/{id}                               {caption?, memeIds?, scheduledAt?|null, status?: "draft"|"queued"|"cancelled", altTexts?} -> PostDetail (409 once publishing)
POST   /posts/{id}/publish-now                   -> 202 PostDetail
POST   /posts/reorder                            {ids[]} -> 204 (queue order for unscheduled queued posts)
GET    /schedule/slots | PUT /schedule/slots     ScheduleSlot[] (admin for PUT)
GET    /schedule/preview?days=14                 -> {at, postId|null}[]

GET    /settings | PATCH /settings               Settings (admin for PATCH)
GET    /audit?cursor=&action=                    -> {items: AuditEvent[], nextCursor}
GET    /ai/usage?days=30                         -> {day, kind, costUsd, calls}[]
Error = {error: string, message: string}  (400, 401, 403, 404, 409, 422, 429 budget_exceeded, 503 feature_disabled)
```

### Instagram

- **Connect:** `https://www.facebook.com/<version>/dialog/oauth?client_id=<Meta app id>&config_id=<config id>&redirect_uri=…&response_type=code&override_default_response_type=true&state=…`. No `scope`: the permissions (`instagram_basic`, `instagram_content_publish`) live in the login configuration. The user signs in with Instagram or Facebook credentials and shares an Instagram professional account from a business portfolio.
- **Callback:** `GET https://graph.facebook.com/<version>/oauth/access_token?client_id&client_secret&code` returns a Business Integration System User token (belongs to the client's business portfolio). `GET /me/assigned_instagram_accounts?fields=id,username` lists the accounts (needs `instagram_basic`); each is stored with the same encrypted token. A single account becomes the default; with several and no default the admin picks one in the `InstagramAccounts` card ("Make default"), and the publisher refuses to guess. Zero accounts stores nothing.
- **Tokens:** a configuration's system-user token defaults to never expiring (`set_token_expires_in_60_days` makes it 60 days). `debug_token` (`expires_at` 0 = never) fills `tokenExpiresAt`. Error code 190, an invalid `debug_token`, or an expired date sets `needsReconnect`; the card shows it and the publisher fails posts with "reconnect the account". Reconnecting clears it. The token is revoked if the client removes the app from the portfolio or moves the account.
- **Host:** every call is on `graph.facebook.com/<INSTAGRAM_GRAPH_VERSION>` (default v27.0) with the `access_token` parameter and the Instagram professional account id in the path.
- **Publish (single):** `POST /{ig-user-id}/media {image_url, caption, alt_text}`, then poll `GET /{container}?fields=status_code` every 5 s for up to 2 minutes until `FINISHED`, then `POST /{ig-user-id}/media_publish {creation_id}`, then `GET /{media-id}?fields=permalink`.
- **Publish (carousel):** child containers with `is_carousel_item=true`, then a parent container with `media_type=CAROUSEL&children=a,b,…&caption`, then publish.
- **Idempotency:** the publisher claims a post atomically (`queued → publishing`, or a `publishing` post stale for 10 minutes). Container ids are saved before polling; editing the caption, memes or alt text drops them. A retry reuses unexpired containers (24 h; an already `PUBLISHED` container is adopted) and, on retries only, checks recent media for a matching caption not claimed by another post, so a timeout after publishing never makes a double post. Rate limits defer 1 h without using an attempt. At most 3 attempts with backoff; then `failed`, and the post returns to the queue on retry.
- **Rate limit:** checks `content_publishing_limit` before publishing; at 95/100 it defers to the next slot.
- **Caption template** (Setting `caption.template`): `{caption}\n\n{credit}\n\n{hashtags}`. `{credit}` is `📸 {creditText}` when the meme has a confirmed attribution, otherwise `Creator unknown — DM for credit/removal`. At most 30 hashtags and 2,200 characters, both checked.
- **Image URL:** a presigned GET valid for 1 hour on `ig/<postId>/<n>.jpg`; Meta fetches it.

### Pages

`/` dashboard (stats, sync status, next posts, AI spend) · `/triage` review queue (large grid, keyboard: `a` accept, `r` reject, `j/k` move, `shift` to select a range, "accept all ≥ x") · `/memes` library (grid with filters, full-text search, bulk actions) · `/memes/[id]` detail (image, AI fields editable, tags, sensitivity warnings, attribution panel with candidates and evidence links, duplicates, "add to post") · `/upload` (drag and drop, multiple files) · `/queue` (drag to reorder queued posts, drafts, caption editor with a live Instagram-style preview and character and hashtag counters) · `/calendar` (two-week slot view) · `/posts/[id]` · `/settings` (Instagram accounts, schedule slots, thresholds, smart-search queries, caption template, budgets, kill switches; admin) · `/activity` (audit log, Immich deletions).

UI: dark-first, dense, desktop-first and usable on a phone. Uses Radix primitives and Tailwind; no component library beyond what Wardrobe uses.

## Work breakdown (parallel build)

The foundation (`F`) lands on `main` first and holds every shared contract: the Prisma schema and first migration, `lib/api/types.ts`, the env schema, job names and payload types registered with stub handlers, the shared clients (`lib/ai/openrouter.ts` with budget and `AiUsage` accounting, `lib/s3.ts`, `lib/immich/types.ts` with the `ImmichClient` interface), the app shell and navigation, and the test helpers. After that, each slice owns its own files and only touches shared files where the table says so. A slice that needs a contract change stops and asks.

| Slice | Owns | Tests (minimum) |
|-------|------|-----------------|
| `immich` | `lib/immich/**` (client implementation, prefilter, sync), jobs `immich.scan` and `immich.delete`, `GET /stats` sync fields | prefilter table tests; client with a stub `fetch`; scan backfill resume and incremental cursor against Postgres; delete refuses when S3 verification fails or the kill switch is off |
| `triage` | `lib/triage/**`, job `triage.classify`, `/api/triage/**`, `app/triage/**` | schema parsing and the auto-accept threshold; decisions API (bulk, idempotent); accept-above (admin only); keyboard navigation component tests |
| `media` | `lib/media/**` (import, renditions, dHash, duplicates), jobs `import.*` and `media.renditions`, `/api/uploads/**`, `/api/memes/{id}/media`, `app/upload/**` | checksum mismatch aborts without delete; HeadObject verification; dHash Hamming distance; duplicate linking; renditions with fixtures (PNG, GIF, tall screenshot); upload flow against MinIO |
| `analysis` | `lib/analysis/**`, job `analysis.meme`, `POST /memes/{id}/analyses` (`kind: meme`), `/api/tags` | JSON-schema validation and tag normalisation; user-edited fields are never overwritten; budget exceeded → 429 and the job is deferred |
| `attribution` | `lib/attribution/**` (clues, web-search prompt, `ReverseImageSearchProvider`), job `attribution.find`, attribution routes, the attribution panel component `components/attribution/**` | candidate parsing and ranking; confirm and reject set the credit text; the no-op provider |
| `library` | `lib/memes/**`, `/api/memes` (list, detail, patch, bulk, delete), `app/memes/**`, `components/memes/**` | filter and query building (full-text search, cursors); bulk actions; status transitions; component tests for the filter bar and the grid |
| `instagram` | `lib/instagram/**` (OAuth, token crypto, Graph client, rendition, publisher), jobs `instagram.*`, `/api/instagram/**` | AES-GCM round-trip; the OAuth dialog URL, state check, code exchange and account discovery (zero, one, several); 190 and token-expiry handling; the publish state machine with a stub Graph API (single, carousel, timeout then retry without a double post, rate-limit deferral); rendition aspect clamping |
| `posts` | `lib/posts/**`, `lib/schedule/**`, job `scheduler.tick`, `/api/posts/**`, `/api/schedule/**`, `app/queue/**`, `app/calendar/**`, `app/posts/**` | slot computation across timezones and DST; FIFO filling; caption template and its limits; one active post per meme; reorder |
| `admin` | `lib/settings/**`, `lib/audit/**` (the `audit()` writer used by all slices is in F), `/api/settings`, `/api/audit`, `/api/ai/usage`, `/api/stats` (except the sync fields), `app/page.tsx` (dashboard), `app/settings/**`, `app/activity/**` | settings validation and defaults; admin gating; stats aggregation |
| `infra` (Codex, in homestacks) | everything under Layout below, plus `docs/README.md` and the Renovate exclusion for the private submodule | `kustomize build` for every touched Kustomization; hk hooks; `tofu validate` in `terraform/openrouter` |

### Cross-slice exports

Modules one slice writes and another calls. A slice that needs one before it is merged creates a minimal version with exactly this signature and says so in its report.

| Export | Owner | Used by |
|--------|-------|---------|
| `syncStats(): Promise<DashboardStatsDto["sync"]>` in `lib/immich/stats.ts` | immich | admin |
| `requestAttribution(memeId, actorId): Promise<AnalysisDto>` in `lib/attribution/request.ts` | attribution | analysis, library |
| `getMemeDetail(id): Promise<MemeDetailDto>` in `lib/memes/service.ts` | library | attribution |
| `presentAnalysis(row): AnalysisDto` in `lib/analysis/present.ts` | analysis | library |
| `renderCaption(post): Promise<{text, warnings}>` in `lib/posts/caption.ts` | posts | instagram |
| `AttributionPanel({meme})` in `components/attribution/attribution-panel.tsx` | attribution | library |
| `InstagramAccounts()` in `components/instagram/instagram-accounts.tsx` | instagram | admin |
| `ScheduleSlotsEditor()` in `components/schedule/schedule-slots-editor.tsx` | posts | admin |

Also in the instagram slice: `POST /api/instagram/accounts/{id}/default` (admin) makes an account the default.

Every slice runs `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before reporting, and adds tests next to its code (`lib/**/*.test.ts`) and in `test/` for database, API and S3 tests.

## Layout in this repo

| Path | What |
|------|------|
| `projects/jester` | App (submodule) |
| `clusters/centerpoint/jester-system/` | `database/`, `secrets/`, `install/` (web and worker Deployments, Service, NetworkPolicies), `routing/`, `flux/` (like `wardrobe-system`) |
| `clusters/sinkhole/jester-aws/` | Crossplane bucket (versioned), IAM user, policy, access key |
| `clusters/sinkhole/crossplane-system/zitadel-apps/` | `jester` and `jester-admin` roles, OIDC app `jester` |
| `clusters/sinkhole/external-secrets-system/` | SecretStore `centerpoint-jester-system`, PushSecrets |
| `clusters/sinkhole/flux-system/image-automation/` | ImageRepository and ImagePolicy `jester` |
| `terraform/openrouter` | `jester_centerpoint` key |

NetworkPolicy egress for both Deployments: DNS, `jester-pg` on 5432, and 443 to the internet outside the pod CIDR (S3, OpenRouter, Zitadel, `immich.vidur.xyz` on Sinkhole, `graph.facebook.com`, `www.facebook.com` for the browser only).

## Manual steps

1. Create an Immich API key (permissions above) and add it as described in `clusters/centerpoint/jester-system/README.md`.
2. Switch the Instagram account to a Creator account. Create a Meta app owned by a business portfolio with the "Manage messaging & content on Instagram" use case, open "API setup with Unified login", create a login configuration with `instagram_basic` and `instagram_content_publish`, set the redirect URI, add the Instagram account as a tester, then add the Meta app id, app secret and configuration id to `04-instagram.secret.yaml`. Connect the account from `/settings`.
3. Verify the Git-managed `jester` and `jester-admin` grants for yourself in Zitadel.
4. Before the first backfill, calibrate: run triage on 200 candidates, review them, then decide whether to turn on auto-accept.

## Open questions

Deferred; not in v1.

- Videos and GIFs as Reels (v1 imports images only; GIFs post their first frame as a still and are marked).
- Stories, engagement insights (`instagram_manage_insights`) and best-time-to-post.
- An iOS Shortcut ingest endpoint with a personal token (phone backup to Immich covers new screenshots for now).
- A paid reverse image search provider (SerpApi Google Lens) behind `ReverseImageSearchProvider`.
- Finer roles for other users (viewer-only, approver) beyond `jester` and `jester-admin`.
- Removal requests from creators: a takedown flow that deletes the post through the API.
