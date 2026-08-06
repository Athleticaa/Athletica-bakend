-- AlterTable
ALTER TABLE "exercises" DROP COLUMN "description",
DROP COLUMN "image",
DROP COLUMN "muscle",
DROP COLUMN "name",
DROP COLUMN "video",
ADD COLUMN     "classification" TEXT[],
ADD COLUMN     "difficulty" VARCHAR NOT NULL,
ADD COLUMN     "equipment" VARCHAR NOT NULL,
ADD COLUMN     "exercise_type" VARCHAR NOT NULL,
ADD COLUMN     "fitness_goals" TEXT[],
ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "media_type" VARCHAR NOT NULL,
ADD COLUMN     "media_url" VARCHAR NOT NULL,
ADD COLUMN     "movement_pattern" VARCHAR NOT NULL,
ADD COLUMN     "name_ar" VARCHAR NOT NULL,
ADD COLUMN     "name_en" VARCHAR NOT NULL,
ADD COLUMN     "primary_muscle" VARCHAR NOT NULL,
ADD COLUMN     "priority" VARCHAR NOT NULL,
ADD COLUMN     "secondary_muscles" TEXT[],
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "video_url" VARCHAR NOT NULL,
ADD COLUMN     "workout_location" VARCHAR NOT NULL;

-- AlterTable
ALTER TABLE "foods" ADD COLUMN     "base_grams" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "category_id" UUID NOT NULL,
ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "food_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR NOT NULL,

    CONSTRAINT "food_categories_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "food_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
