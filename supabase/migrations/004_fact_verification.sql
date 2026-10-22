-- Neutral News — retrieval-backed fact verification and the publication gate
--
-- Background: on 2026-10-19 the article "Musk Says He Will Give Every American
-- Child One Share of SpaceX" published the key fact "SpaceX is privately held;
-- shares do not trade on public markets" — four months after SpaceX listed on
-- Nasdaq as SPCX, in a story about the market value of SpaceX shares.
--
-- The review record stored for that article shows the failure precisely. Grok
-- flagged the exact sentence at `required` severity. The final validator read
-- the flag, described the claim as "widely corroborated public facts" on the
-- strength of its own training data, and approved at 8.8 confidence. Four of
-- that day's five stories had required corrections waived the same way, so the
-- gate was not a gate.
--
-- Two changes needed storage:
--   1. A verification stage that checks the article's standalone claims against
--      live sources, so the pipeline can tell "unsourced" from "false".
--   2. A publication gate decided in code (pipeline/gate.js) rather than in the
--      validator's prose, with the reasoning kept for audit.

alter table neutral_articles
  -- 'ok' when verification ran; otherwise why it did not. A non-ok status is
  -- itself a blocker: losing the check must not mean passing it.
  add column if not exists verification_status text,

  -- One entry per standalone claim checked: the claim, the article text that
  -- makes it, a SUPPORTED/CONTRADICTED/UNVERIFIED verdict, the evidence, and
  -- the sources behind it.
  add column if not exists verification_claims jsonb not null default '[]'::jsonb,

  -- URLs the verifier actually retrieved. The gate will only accept a waiver
  -- that cites one of these (or a listed reference) as external evidence.
  add column if not exists verification_sources jsonb not null default '[]'::jsonb,

  -- URLs the writer consulted while drafting.
  add column if not exists research_sources jsonb not null default '[]'::jsonb,

  -- The validator's account of what became of each required issue: removed,
  -- corrected, or supported — and, for supported, the evidence it named. This
  -- is the record that makes a waiver reviewable after the fact.
  add column if not exists required_issue_dispositions jsonb not null default '[]'::jsonb,

  -- The gate's verdict and, when it blocked, why.
  add column if not exists gate_passed boolean,
  add column if not exists gate_blockers jsonb not null default '[]'::jsonb;

-- Finding published articles that still carry a contradicted claim, or that
-- published without verification, should be a cheap query — this is the check
-- to run after any change to the verification prompts.
create index if not exists idx_neutral_articles_verification_status
  on neutral_articles (verification_status);
