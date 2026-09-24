-- Make the 3 default progress-photo questions optional.
-- Scoped by exact default text so custom coach IMAGE questions keep their flag.
UPDATE "checkin_questions"
SET "required" = false
WHERE "type"::text = 'IMAGE'
  AND "required" = true
  AND "question" IN (
    'Progress Photo – Front',
    'Progress Photo – Side',
    'Progress Photo – Back'
  );
