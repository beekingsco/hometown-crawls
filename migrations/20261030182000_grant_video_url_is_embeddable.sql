-- shop_listings.video_url and crawls.video_url CHECK constraints call
-- private.video_url_is_embeddable. The video migration revoked EXECUTE
-- from public, anon, and authenticated, so only the owner (postgres)
-- could run the function. Postgres checks that privilege as the role
-- doing the write, including photo-only updates from the magic-link
-- shop portal (authenticated).
--
-- The function body and security mode are unchanged. It is immutable,
-- has an empty search_path, and only classifies a URL string.
-- Schema USAGE on private was already granted to these roles.
--
-- Already applied on production (tatwbjuwufeqynpufodq). Safe to re-run.
-- Apply manually. Do not run from the app.

grant execute on function private.video_url_is_embeddable(text) to authenticated;
grant execute on function private.video_url_is_embeddable(text) to anon;
