-- Add question_type column to client_questions with default 'choice' for existing rows
ALTER TABLE "client_questions" ADD COLUMN "question_type" VARCHAR NOT NULL DEFAULT 'choice';

-- Change answer column in client_answers from INTEGER to VARCHAR
-- First convert existing integer answers to their string representation
ALTER TABLE "client_answers" ALTER COLUMN "answer" TYPE VARCHAR USING "answer"::VARCHAR;
