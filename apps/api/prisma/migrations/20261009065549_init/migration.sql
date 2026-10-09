-- CreateEnum
CREATE TYPE "story_style" AS ENUM ('facts', 'fairy_tale', 'history');

-- CreateEnum
CREATE TYPE "topic_reason" AS ENUM ('proposed', 'requested');

-- CreateEnum
CREATE TYPE "job_kind" AS ENUM ('suggest_topics', 'write_story', 'render_audio');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "voices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tts_provider" TEXT NOT NULL,
    "provider_voice_id" TEXT NOT NULL,
    "sample_audio_path" TEXT NOT NULL,
    "asleep_prompt_audio_path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "voice_id" UUID NOT NULL,
    "styles" "story_style"[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_interests" (
    "user_id" UUID NOT NULL,
    "interest_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_interests_pkey" PRIMARY KEY ("user_id","interest_id")
);

-- CreateTable
CREATE TABLE "user_custom_interests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_custom_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "style" "story_style" NOT NULL,
    "interest_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "topic_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "llm_model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_audio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "story_id" UUID NOT NULL,
    "voice_id" UUID NOT NULL,
    "storage_path" TEXT NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "tts_provider" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_audio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_topics" (
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "reason" "topic_reason" NOT NULL,
    "dismissed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_topics_pkey" PRIMARY KEY ("user_id","topic_id")
);

-- CreateTable
CREATE TABLE "queue_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "voice_id" UUID NOT NULL,
    "listened_sec" INTEGER NOT NULL,
    "listened_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_ratings" (
    "user_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_ratings_pkey" PRIMARY KEY ("user_id","story_id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "job_kind" NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "requested_by_user_id" UUID,
    "status" "job_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voices_slug_key" ON "voices"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "interests_slug_key" ON "interests"("slug");

-- CreateIndex
CREATE INDEX "user_custom_interests_user_id_idx" ON "user_custom_interests"("user_id");

-- CreateIndex
CREATE INDEX "topics_interest_id_idx" ON "topics"("interest_id");

-- CreateIndex
CREATE UNIQUE INDEX "stories_topic_id_key" ON "stories"("topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_audio_storage_path_key" ON "story_audio"("storage_path");

-- CreateIndex
CREATE UNIQUE INDEX "story_audio_story_id_voice_id_key" ON "story_audio"("story_id", "voice_id");

-- CreateIndex
CREATE INDEX "queue_items_user_id_position_idx" ON "queue_items"("user_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "queue_items_user_id_topic_id_key" ON "queue_items"("user_id", "topic_id");

-- CreateIndex
CREATE INDEX "listens_user_id_listened_at_idx" ON "listens"("user_id", "listened_at" DESC);

-- CreateIndex
CREATE INDEX "generation_jobs_requested_by_user_id_created_at_idx" ON "generation_jobs"("requested_by_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_voice_id_fkey" FOREIGN KEY ("voice_id") REFERENCES "voices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_custom_interests" ADD CONSTRAINT "user_custom_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_audio" ADD CONSTRAINT "story_audio_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_audio" ADD CONSTRAINT "story_audio_voice_id_fkey" FOREIGN KEY ("voice_id") REFERENCES "voices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_topics" ADD CONSTRAINT "user_topics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_topics" ADD CONSTRAINT "user_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listens" ADD CONSTRAINT "listens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listens" ADD CONSTRAINT "listens_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listens" ADD CONSTRAINT "listens_voice_id_fkey" FOREIGN KEY ("voice_id") REFERENCES "voices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_ratings" ADD CONSTRAINT "story_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_ratings" ADD CONSTRAINT "story_ratings_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL: Prisma cannot express the following.
-- ---------------------------------------------------------------------------

-- Row level security on every table, with no policies. Only the API (a
-- privileged database role) reads or writes; client roles get nothing.
ALTER TABLE "voices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_interests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_custom_interests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "topics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "story_audio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_topics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queue_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "listens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "story_ratings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generation_jobs" ENABLE ROW LEVEL SECURITY;

-- Prisma's own bookkeeping table is also exposed through the API schema.
-- It exists in the real database but not in the shadow database while the
-- migration is replayed, so the statement is guarded.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;

-- CHECK constraints.
ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_styles_not_empty"
  CHECK ("styles" IS NOT NULL AND cardinality("styles") >= 1);

ALTER TABLE "user_custom_interests"
  ADD CONSTRAINT "user_custom_interests_title_not_blank"
  CHECK ("title" ~ '[^[:space:]]');

ALTER TABLE "stories"
  ADD CONSTRAINT "stories_char_count_positive"
  CHECK ("char_count" > 0);

ALTER TABLE "story_audio"
  ADD CONSTRAINT "story_audio_duration_sec_positive"
  CHECK ("duration_sec" > 0);

ALTER TABLE "story_audio"
  ADD CONSTRAINT "story_audio_byte_size_positive"
  CHECK ("byte_size" > 0);

ALTER TABLE "listens"
  ADD CONSTRAINT "listens_listened_sec_non_negative"
  CHECK ("listened_sec" >= 0);

ALTER TABLE "story_ratings"
  ADD CONSTRAINT "story_ratings_rating_valid"
  CHECK ("rating" IN (-1, 1));

-- At most one active (pending or running) job per dedupe key. Finished jobs may
-- share a key with a new one, so a failed or succeeded job can be re-requested.
CREATE UNIQUE INDEX "generation_jobs_dedupe_key_active_key"
  ON "generation_jobs" ("dedupe_key")
  WHERE "status" IN ('pending', 'running');
