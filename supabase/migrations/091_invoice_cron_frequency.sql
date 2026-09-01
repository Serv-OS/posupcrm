-- The daily 06:00 run only makes sense when one invocation can finish the job.
-- It cannot: sending is capped at 2 per run (building a PDF costs more CPU than
-- an edge function gets for a whole invocation), so a month with twelve due
-- schedules would take days to send at one run a day.
--
-- Every 15 minutes instead. Generation stays same-day and immediate; the send
-- queue drains within an hour or so instead of a week. On the ~95 runs a day
-- with nothing due it is a single indexed query returning no rows.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'invoice-recurring-daily'),
  schedule := '*/15 * * * *'
);
