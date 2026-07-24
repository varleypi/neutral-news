-- Neutral News — story continuity & duplicate consolidation
--
-- Background: the pipeline selected each day's clusters with no memory of
-- previous days, so a story that stayed top-ranked (a war, a tournament final,
-- a leadership change) was rewritten as a brand-new article — and therefore a
-- brand-new URL — every day it led the coverage. That produced sets of
-- near-identical pages, which reads as thin/duplicate content to search and ad
-- crawlers.
--
-- This migration adds the columns needed to (a) update a continuing story in
-- place at its original URL, and (b) point already-published duplicates at the
-- original so crawlers consolidate them instead of counting them separately.

alter table neutral_articles
  -- When set, this article duplicates an earlier one and should emit a
  -- <link rel="canonical"> pointing at that article instead of itself.
  add column if not exists canonical_article_id bigint references neutral_articles (id),

  -- Set when a continuing story is refreshed in place. Null means the article
  -- has not been revised since first publication.
  add column if not exists last_updated_at timestamptz,

  -- How many times this article has been refreshed in place.
  add column if not exists update_count int not null default 0;

-- The pipeline now looks back over recent days by cluster to decide whether a
-- candidate is a continuing story.
create index if not exists idx_neutral_articles_cluster_date
  on neutral_articles (cluster_id, date desc);

-- The sitemap filters duplicates out via this column. Archive listings keep
-- them, so each day's edition stays an accurate historical record — the
-- canonical tag is what tells crawlers which copy is authoritative.
create index if not exists idx_neutral_articles_canonical
  on neutral_articles (canonical_article_id)
  where canonical_article_id is not null;

comment on column neutral_articles.canonical_article_id is
  'If set, this article is a duplicate of the referenced article; pages emit a canonical tag to it and it is excluded from the sitemap.';
comment on column neutral_articles.last_updated_at is
  'Timestamp of the most recent in-place refresh of a continuing story.';
