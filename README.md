# memes

Finds the memes in Immich, moves them to S3, tags them and looks for their
creators with AI, and posts them to Instagram on a schedule. Design and
build contract: [`docs/memes.md` in gpdl49/homestacks](https://github.com/gpdl49/homestacks/blob/main/docs/memes.md)
(copy in [docs/contract.md](docs/contract.md)). Agent conventions:
[AGENTS.md](AGENTS.md).

## Local development

```sh
docker compose up -d          # Postgres (memes, memes_test) and MinIO
cp .env.example .env
pnpm install
pnpm db:deploy
pnpm dev                      # http://localhost:3000, signed in as a dev admin
```

`pnpm test` runs unit tests always and database tests when
`TEST_DATABASE_URL` is set (`.env.example` points at `memes_test`).

Without `OPENROUTER_API_KEY`, `IMMICH_API_KEY` or the Instagram credentials
the matching features report `feature_disabled` (503) and stay off.

## Deployment

CI builds `ghcr.io/gpdl49/memes:main`; Flux image automation on Sinkhole
rolls it out to `memes-system` on Centerpoint as two Deployments, `memes`
(web) and `memes-worker` (`JOBS_ENABLED=true`). Manifests live in
gpdl49/homestacks under `clusters/centerpoint/memes-system`.
