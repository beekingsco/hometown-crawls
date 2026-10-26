# Support form

`/support` is a public page. The form posts JSON to the Vercel function `api/support.js` (`/api/support`). That function emails the note through Resend. It does not use Supabase and it does not use a service role key.

The From address is the verified sender already used for shop receipts:

`Hometown Crawls <hello@hometowncrawls.com>`

Reply-To is the email the person typed, so a reply goes back to them.

The subject looks like:

`[Hometown Crawls Support] Shop host — QR would not stamp at the counter.`

## Environment variables

Set these on the Vercel project **hometown-crawls** (Production, and Preview if you want the form to send there). They are server-side only.

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes | Same key as the shop receipt. Without it the form answers that email is not set up. |
| `SUPPORT_TO_EMAIL` | No | Inbox that receives the note. When unset, the code sends to `hello@hometowncrawls.com`. |

`.env.example` lists the same names. Do not commit a real `RESEND_API_KEY`.

## Related pages

| Path | Who |
| --- | --- |
| `/account/store/help` | Shop hosts. Linked from the Store tab. |
| `/account/organizer/help` | Organizers. Linked from the Organizer tab. |
| `/support` | Anyone. Linked from the footer and both checklists. |

Host and organizer checklists are `noindex`. `/support` is in the sitemap.

## Verify locally

Static pages, from the site root:

```bash
python3 -m http.server 8080
```

Open:

- http://localhost:8080/account/store/help
- http://localhost:8080/account/organizer/help
- http://localhost:8080/support
- http://localhost:8080/account.html for the Instructions buttons (the Store and Organizer tabs appear for a shop or organizer sign-in; `?demo=1` only shows sample layout)

The Python server does not run `/api/support`. Check the sender with:

```bash
node --test test/support.test.js test/host-guides.test.js
```

A real send needs the Vercel dev server (or a deploy) with `RESEND_API_KEY` set. Leave `SUPPORT_TO_EMAIL` unset to use `hello@hometowncrawls.com`, or set it to a mailbox you can read.
