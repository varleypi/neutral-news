-- Neutral News — daily X (Twitter) post log
--
-- The pipeline can run more than once for the same date (SpinDetector's
-- repository_dispatch fires it, and the 13:00 UTC schedule is a backup). Storing
-- one row per edition date lets pipeline/social.js see that the thread has
-- already gone out and skip, rather than posting a near-identical thread twice.

create table if not exists neutral_social_posts (
  date       date primary key,
  thread_id  text,          -- id of the root post, so the thread can be found again
  post_count int default 0, -- root + replies actually sent
  posted_at  timestamptz default now()
);

alter table neutral_social_posts enable row level security;

-- No public read policy: this is pipeline bookkeeping, not site content.
create policy "Service role write neutral_social_posts"
  on neutral_social_posts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
