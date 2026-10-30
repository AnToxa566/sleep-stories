/*
  Warnings:

  - You are about to drop the column `asleep_prompt_audio_path` on the `voices` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "voices" DROP COLUMN "asleep_prompt_audio_path";
