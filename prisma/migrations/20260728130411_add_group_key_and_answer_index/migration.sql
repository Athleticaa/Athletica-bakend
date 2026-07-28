-- CreateTable
CREATE TABLE "client_questions" (
    "id" UUID NOT NULL,
    "group_key" UUID NOT NULL,
    "question" VARCHAR NOT NULL,
    "choices" TEXT[],
    "language" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_answers" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_questions_group_key_idx" ON "client_questions"("group_key");

-- CreateIndex
CREATE UNIQUE INDEX "client_questions_question_language_key" ON "client_questions"("question", "language");

-- CreateIndex
CREATE UNIQUE INDEX "client_answers_client_id_question_id_key" ON "client_answers"("client_id", "question_id");

-- AddForeignKey
ALTER TABLE "client_answers" ADD CONSTRAINT "client_answers_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_answers" ADD CONSTRAINT "client_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "client_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
