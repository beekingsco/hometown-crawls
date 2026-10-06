const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const migrationPath = path.join(
  __dirname,
  "..",
  "migrations",
  "20261006150000_organizer_co_organizers.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("co-organizer migration is security definer, locked down, and does not send email", () => {
  assert.match(sql, /function public\.organizer_add_co_organizer\(/);
  assert.match(sql, /p_crawl_id text/);
  assert.match(sql, /p_email text/);
  assert.match(sql, /p_name text default null/);
  assert.match(sql, /function public\.organizer_list_co_organizers\(p_crawl_id text\)/);
  assert.match(sql, /function public\.organizer_remove_co_organizer\(/);
  assert.match(sql, /function public\.organizer_claim_by_email\(\)/);
  assert.match(sql, /private\.is_crawl_organizer\(v_crawl\)/);
  assert.match(sql, /private\.link_organizer_on_auth_user\(\)/);
  assert.match(sql, /co-organizer/);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path to ''/i);
  assert.match(sql, /revoke all on function public\.organizer_add_co_organizer\(text, text, text\) from anon/i);
  assert.match(sql, /grant execute on function public\.organizer_add_co_organizer\(text, text, text\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.organizer_claim_by_email\(\) to authenticated/i);
  assert.match(sql, /An owner cannot be removed/);
  assert.match(sql, /Only the crawl owner can remove a co-organizer/);
  assert.match(sql, /You are the last owner or organizer on this crawl/);
  assert.match(sql, /auth\.jwt\(\)/);
  assert.match(sql, /email_confirmed_at/);
  assert.match(sql, /organizers_link_auth_user/);
  assert.match(sql, /update public\.organizers o/);
  assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data/);
  assert.doesNotMatch(sql, /net\.http|pg_net|resend|send_email|invite email/i);
});

test("co-organizer migration applies twice on a local auth stub", () => {
  execFileSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", "drop database if exists hc_coorg_test"], {
    stdio: "pipe"
  });
  execFileSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", "create database hc_coorg_test"], {
    stdio: "pipe"
  });
  execFileSync(
    "sudo",
    ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-d", "hc_coorg_test", "-f", path.join(__dirname, "co-organizer.pg.sql")],
    { stdio: "pipe" }
  );
});
