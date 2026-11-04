-- Households as profiles (Task 2 fix round 2): when an add's own record — the
-- history line, audit, notices and dispute check — was claimed for a
-- membership. Claimed with a compare-and-set (recorded_at IS NULL → now), so
-- two concurrent identical adds can't record the link twice, and released
-- again when the history write fails, so the next add by the same person
-- completes it. NULL on memberships written by other paths (conversion,
-- forms) until someone records them.
ALTER TABLE household_memberships ADD recorded_at INTEGER;
