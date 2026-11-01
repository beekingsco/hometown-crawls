-- Guest photo signed URLs and organizer pending previews.
-- Already applied live on Hometown Crawls (ref tatwbjuwufeqynpufodq)
-- as migration guest_photos_signed_url_and_organizer_preview
-- (version 20261101204417). This file is the repo copy of that SQL.
-- Idempotent. Apply by hand. A static-site deploy does not run it.
--
-- Root cause: storage policy EXISTS on public.guest_photos failed for anon
-- (no GRANT) and for authenticated non-owners (RLS own-rows only). Organizers
-- also had no storage SELECT on pending objects.

set local lock_timeout = '5s';

GRANT SELECT ON TABLE public.guest_photos TO anon, authenticated;

DROP POLICY IF EXISTS guest_photos_select_approved ON public.guest_photos;
CREATE POLICY guest_photos_select_approved
  ON public.guest_photos
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

CREATE OR REPLACE FUNCTION private.can_sign_guest_photo(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.guest_photos g
    WHERE g.path = object_name
      AND (
        g.status = 'approved'
        OR g.user_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.crawl_organizers co
          JOIN public.organizers o ON o.id = co.organizer_id
          WHERE co.crawl_id = g.crawl_id
            AND o.user_id = (SELECT auth.uid())
            AND co.role IN ('owner', 'organizer', 'co-organizer', 'contributor')
        )
      )
  );
$fn$;

REVOKE ALL ON FUNCTION private.can_sign_guest_photo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_sign_guest_photo(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS guest_photos_organizer_select ON storage.objects;
CREATE POLICY guest_photos_organizer_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'guest-photos'
    AND private.can_sign_guest_photo(name)
  );
