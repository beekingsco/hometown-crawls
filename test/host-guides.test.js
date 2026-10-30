const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const account = read("account.html");
const storeHelp = read("account/store/help/index.html");
const organizerHelp = read("account/organizer/help/index.html");
const vercel = read("vercel.json");

test("Store and Organizer tabs link to the checklists", () => {
  assert.match(account, /id="store-help-link" href="\/account\/store\/help"/);
  assert.match(account, /id="organizer-help-link" href="\/account\/organizer\/help"/);
  assert.match(account, /store checklist/);
  assert.match(account, /organizer checklist/);
  assert.match(account, /href="\/support">Support/);
});

test("store checklist covers the host steps and does not add a bypass", () => {
  for (const phrase of [
    "Send magic link",
    "/account",
    "Counter code",
    "Print counter sign",
    "50 meters",
    "There is no location bypass",
    "Post-stamp coupon",
    "zip code",
    "Save listing",
    "paper card",
    "Holiday Cafe",
    "/card?crawl=puy-coffee",
    "Completed paper cards must be turned in by end of day December 31, 2026 (Pacific).",
    "Paper stamps count the same as stamps in the web app. Guests can switch to the web app anytime.",
    "/account/organizer/help",
    "/support",
  ]) {
    assert.match(storeHelp, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(storeHelp, /Host guide/);
  assert.match(storeHelp, /the counter card/);
  assert.doesNotMatch(storeHelp, /shop counter card|Store · Testing/);
  assert.match(storeHelp, /noindex/);
  assert.doesNotMatch(storeHelp, /service_role|RESEND_API_KEY|demo=1/);
  assert.match(vercel, /"source": "\/account\/store\/help"/);
  assert.match(vercel, /"destination": "\/account\/store\/help\/index.html"/);
});

test("organizer checklist covers crawl setup, paper stamps, and the counter pilot", () => {
  for (const phrase of [
    "Title and dates",
    "Save crawl",
    "Paid",
    "Unpaid",
    "Show on the passport",
    "Save shop",
    "zip code",
    "Players",
    "digital stamp stays checked",
    "Holiday Cafe",
    "ANTHEM",
    "Print counter sign",
    "50 meters",
    "There is no location bypass",
    "/card?crawl=puy-coffee",
    "blank=1",
    "Completed paper cards must be turned in by end of day December 31, 2026 (Pacific).",
    "Paper stamps count the same as stamps in the web app. Guests can switch to the web app anytime.",
    "/account/store/help",
    "/support",
    "puy-coffee",
  ]) {
    assert.match(organizerHelp, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(organizerHelp, /Organizer guide/);
  assert.doesNotMatch(organizerHelp, /Organizer · Testing/);
  assert.match(organizerHelp, /guide-column/);
  assert.match(organizerHelp, /noindex/);
  assert.doesNotMatch(organizerHelp, /service_role|RESEND_API_KEY/);
  assert.match(vercel, /"source": "\/account\/organizer\/help"/);
});

test("a visible Store or Organizer tab opens from the account link", () => {
  const els = {};
  function make(id, hidden) {
    const classes = new Set(hidden ? ["hidden"] : []);
    return {
      id,
      hidden: !!hidden,
      attrs: {},
      classList: {
        contains(name) { return classes.has(name); },
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
      },
      setAttribute(name, value) { this.attrs[name] = value; },
      getAttribute(name) { return this.attrs[name]; },
    };
  }
  ["panel-guest", "panel-store", "panel-organizer", "tab-guest", "tab-store", "tab-organizer", "role-tabs"].forEach((id) => {
    els[id] = make(id, id === "tab-organizer" || id === "role-tabs" || id === "panel-store" || id === "panel-organizer");
  });
  const replaced = [];
  const sandbox = {
    URL,
    URLSearchParams,
    console,
    localStorage: { getItem() { return null; }, setItem() {} },
    history: { replaceState(_state, _title, next) { replaced.push(next); } },
    location: {
      href: "https://www.hometowncrawls.com/account?tab=store",
      search: "?tab=store",
      pathname: "/account",
    },
    document: {
      getElementById(id) { return els[id] || null; },
      addEventListener() {},
      querySelectorAll() { return []; },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/store-demo.js"), sandbox, { filename: "assets/store-demo.js" });
  sandbox.HCStoreDemo.openRequestedTab();
  assert.equal(els["panel-store"].hidden, false);
  assert.equal(els["panel-guest"].hidden, true);
  assert.equal(els["tab-store"].attrs["aria-selected"], "true");
  assert.match(replaced[0], /tab=store/);

  els["tab-organizer"].classList.add("hidden");
  sandbox.location.search = "?tab=organizer";
  sandbox.location.href = "https://www.hometowncrawls.com/account?tab=organizer";
  const before = els["panel-store"].hidden;
  sandbox.HCStoreDemo.openRequestedTab();
  assert.equal(els["panel-store"].hidden, before);

  assert.match(read("assets/store-listing.js"), /openRequestedTab/);
  assert.match(read("assets/organizer-panel.js"), /openRequestedTab/);
  assert.match(read("assets/stamp-art.js"), /openRequestedTab/);
  assert.match(read("assets/site.js"), /path\.startsWith\("\/account\/"\)/);
});
