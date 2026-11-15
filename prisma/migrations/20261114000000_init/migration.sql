-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TriageStatus" AS ENUM ('unscored', 'pending', 'scored', 'accepted', 'rejected', 'imported', 'deleted', 'error');

-- CreateEnum
CREATE TYPE "MemeSource" AS ENUM ('immich', 'upload');

-- CreateEnum
CREATE TYPE "MemeStatus" AS ENUM ('inbox', 'approved', 'rejected', 'archived');

-- CreateEnum
CREATE TYPE "TagKind" AS ENUM ('topic', 'template', 'style', 'user');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('ai', 'user');

-- CreateEnum
CREATE TYPE "AnalysisKind" AS ENUM ('triage', 'meme', 'attribution');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "AttributionPlatform" AS ENUM ('instagram', 'x', 'reddit', 'tiktok', 'tumblr', 'ninegag', 'ifunny', 'web', 'other');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'complete', 'imported', 'failed');

-- CreateEnum
CREATE TYPE "DeletionStatus" AS ENUM ('pending', 'done', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('image', 'carousel');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('draft', 'queued', 'publishing', 'published', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "sub" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "id" TEXT NOT NULL,
    "cursor" TEXT,
    "backfill_page" INTEGER NOT NULL DEFAULT 1,
    "backfill_done" BOOLEAN NOT NULL DEFAULT false,
    "smart_done" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "immich_assets" (
    "id" UUID NOT NULL,
    "immich_id" UUID NOT NULL,
    "checksum" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "file_created_at" TIMESTAMP(3),
    "camera_make" TEXT,
    "camera_model" TEXT,
    "ocr_text" TEXT,
    "prefilter_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prefilter_signals" JSONB NOT NULL DEFAULT '{}',
    "smart_hits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triage_status" "TriageStatus" NOT NULL DEFAULT 'unscored',
    "meme_probability" DOUBLE PRECISION,
    "triage_model" TEXT,
    "triage_result" JSONB,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "meme_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "immich_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memes" (
    "id" UUID NOT NULL,
    "source" "MemeSource" NOT NULL,
    "status" "MemeStatus" NOT NULL DEFAULT 'inbox',
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "dhash" TEXT,
    "blurhash" TEXT,
    "taken_at" TIMESTAMP(3),
    "ocr_text" TEXT,
    "description" TEXT,
    "alt_text" TEXT,
    "template" TEXT,
    "language" TEXT,
    "era" TEXT,
    "postability" INTEGER,
    "caption_draft" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sensitivity" JSONB,
    "quality" JSONB,
    "rating" INTEGER,
    "notes" TEXT,
    "duplicate_of_id" UUID,
    "attribution_id" UUID,
    "credit_text" TEXT,
    "renditions_ready" BOOLEAN NOT NULL DEFAULT false,
    "user_edited" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "search" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce("template", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce("ocr_text", '')), 'B') ||
        setweight(to_tsvector('english', coalesce("alt_text", '')), 'C')
    ) STORED,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TagKind" NOT NULL DEFAULT 'topic',

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meme_tags" (
    "meme_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "source" "TagSource" NOT NULL DEFAULT 'ai',

    CONSTRAINT "meme_tags_pkey" PRIMARY KEY ("meme_id","tag_id")
);

-- CreateTable
CREATE TABLE "analyses" (
    "id" UUID NOT NULL,
    "meme_id" UUID,
    "kind" "AnalysisKind" NOT NULL,
    "model" TEXT,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "cost_usd" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_candidates" (
    "id" UUID NOT NULL,
    "meme_id" UUID NOT NULL,
    "analysis_id" UUID,
    "creator_name" TEXT,
    "handle" TEXT,
    "platform" "AttributionPlatform" NOT NULL,
    "url" TEXT,
    "evidence" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "meme_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "immich_deletions" (
    "id" UUID NOT NULL,
    "immich_asset_id" UUID NOT NULL,
    "immich_id" UUID NOT NULL,
    "meme_id" UUID,
    "status" "DeletionStatus" NOT NULL DEFAULT 'pending',
    "verified_sha256" TEXT,
    "error" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "immich_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_accounts" (
    "id" UUID NOT NULL,
    "ig_user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "connected_by_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL,
    "account_id" UUID,
    "kind" "PostKind" NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'draft',
    "caption" TEXT NOT NULL DEFAULT '',
    "queue_position" INTEGER,
    "scheduled_at" TIMESTAMP(3),
    "slot_id" UUID,
    "container_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "container_at" TIMESTAMP(3),
    "ig_media_id" TEXT,
    "permalink" TEXT,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_items" (
    "post_id" UUID NOT NULL,
    "meme_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "alt_text" TEXT,

    CONSTRAINT "post_items_pkey" PRIMARY KEY ("post_id","position")
);

-- CreateTable
CREATE TABLE "schedule_slots" (
    "id" UUID NOT NULL,
    "account_id" UUID,
    "weekday" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ref_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_sub_key" ON "users"("sub");

-- CreateIndex
CREATE UNIQUE INDEX "immich_assets_immich_id_key" ON "immich_assets"("immich_id");

-- CreateIndex
CREATE UNIQUE INDEX "immich_assets_meme_id_key" ON "immich_assets"("meme_id");

-- CreateIndex
CREATE INDEX "immich_assets_triage_status_meme_probability_idx" ON "immich_assets"("triage_status", "meme_probability");

-- CreateIndex
CREATE INDEX "immich_assets_prefilter_score_idx" ON "immich_assets"("prefilter_score");

-- CreateIndex
CREATE UNIQUE INDEX "memes_sha256_key" ON "memes"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "memes_attribution_id_key" ON "memes"("attribution_id");

-- CreateIndex
CREATE INDEX "memes_status_created_at_idx" ON "memes"("status", "created_at");

-- CreateIndex
CREATE INDEX "memes_postability_idx" ON "memes"("postability");

-- CreateIndex
CREATE INDEX "memes_dhash_idx" ON "memes"("dhash");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "meme_tags_tag_id_idx" ON "meme_tags"("tag_id");

-- CreateIndex
CREATE INDEX "analyses_meme_id_kind_created_at_idx" ON "analyses"("meme_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "attribution_candidates_meme_id_rank_idx" ON "attribution_candidates"("meme_id", "rank");

-- CreateIndex
CREATE INDEX "immich_deletions_at_idx" ON "immich_deletions"("at");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_accounts_ig_user_id_key" ON "instagram_accounts"("ig_user_id");

-- CreateIndex
CREATE INDEX "posts_status_scheduled_at_idx" ON "posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "post_items_meme_id_idx" ON "post_items"("meme_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_items_post_id_meme_id_key" ON "post_items"("post_id", "meme_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_slots_account_id_weekday_time_key" ON "schedule_slots"("account_id", "weekday", "time");

-- CreateIndex
CREATE INDEX "ai_usage_at_idx" ON "ai_usage"("at");

-- CreateIndex
CREATE INDEX "audit_events_at_idx" ON "audit_events"("at");

-- CreateIndex
CREATE INDEX "audit_events_action_at_idx" ON "audit_events"("action", "at");

-- AddForeignKey
ALTER TABLE "immich_assets" ADD CONSTRAINT "immich_assets_meme_id_fkey" FOREIGN KEY ("meme_id") REFERENCES "memes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memes" ADD CONSTRAINT "memes_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "memes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memes" ADD CONSTRAINT "memes_attribution_id_fkey" FOREIGN KEY ("attribution_id") REFERENCES "attribution_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meme_tags" ADD CONSTRAINT "meme_tags_meme_id_fkey" FOREIGN KEY ("meme_id") REFERENCES "memes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meme_tags" ADD CONSTRAINT "meme_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_meme_id_fkey" FOREIGN KEY ("meme_id") REFERENCES "memes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_candidates" ADD CONSTRAINT "attribution_candidates_meme_id_fkey" FOREIGN KEY ("meme_id") REFERENCES "memes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_candidates" ADD CONSTRAINT "attribution_candidates_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_meme_id_fkey" FOREIGN KEY ("meme_id") REFERENCES "memes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "immich_deletions" ADD CONSTRAINT "immich_deletions_immich_asset_id_fkey" FOREIGN KEY ("immich_asset_id") REFERENCES "immich_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "immich_deletions" ADD CONSTRAINT "immich_deletions_meme_id_fkey" FOREIGN KEY ("meme_id") REFERENCES "memes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "instagram_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "schedule_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_items" ADD CONSTRAINT "post_items_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_items" ADD CONSTRAINT "post_items_meme_id_fkey" FOREIGN KEY ("meme_id") REFERENCES "memes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text search over memes (docs/jester.md); query with
-- "search" @@ websearch_to_tsquery('simple', $1) and rank with ts_rank.
CREATE INDEX "memes_search_idx" ON "memes" USING GIN ("search");

