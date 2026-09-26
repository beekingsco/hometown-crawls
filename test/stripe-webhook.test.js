const test = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");

const stripeLib = new Stripe("unit-test-not-a-real-key");
const webhook = require("../api/stripe-webhook");

const { handleEvent, handleRequest, _test } = webhook;
const PAYMENT_URL = "https://buy.stripe.com/8x214n6gm4Op89Ja9ngQE0e";
const SIGNUP_ID = "3184b52b-0bce-47bf-a929-2d46329b2ba0";

function memorySupabase(seed) {
  const state = {
    signups: (seed.signups || []).map((row) => ({ ...row })),
    listings: (seed.listings || []).map((row) => ({ ...row })),
    crawls: (seed.crawls || []).map((row) => ({ ...row })),
    calls: [],
  };
  const tables = {
    crawl_signups: state.signups,
    shop_listings: state.listings,
    crawls: state.crawls,
  };

  function from(table) {
    const rows = tables[table];
    const query = {
      _filters: [],
      _patch: null,
      _insert: null,
      _single: false,
      select() {
        return query;
      },
      eq(col, val) {
        query._filters.push([col, val]);
        return query;
      },
      insert(row) {
        query._insert = row;
        state.calls.push({ op: "insert", table, row });
        return query;
      },
      update(patch) {
        query._patch = patch;
        state.calls.push({ op: "update", table, patch });
        return query;
      },
      maybeSingle() {
        query._single = true;
        return query;
      },
      single() {
        query._single = true;
        return query;
      },
      then(resolve, reject) {
        return query._run().then(resolve, reject);
      },
      _run() {
        const matched = () => rows.filter((row) => query._filters.every(([col, val]) => row[col] === val));
        if (query._insert) {
          if (table === "shop_listings" && rows.some((row) => row.signup_id === query._insert.signup_id)) {
            return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } });
          }
          const created = {
            id: "listing-" + rows.length,
            is_paid: false,
            paid_at: null,
            stripe_session_id: null,
            amount_paid_cents: null,
            payment_source: null,
            ...query._insert,
          };
          rows.push(created);
          return Promise.resolve({ data: query._single ? created : [created], error: null });
        }
        if (query._patch) {
          const hits = matched();
          hits.forEach((row) => Object.assign(row, query._patch));
          return Promise.resolve({ data: hits, error: null });
        }
        const hits = matched();
        return Promise.resolve({ data: query._single ? hits[0] || null : hits, error: null });
      },
    };
    return query;
  }

  return { from, state };
}

function crawlRow() {
  return {
    id: "puy-coffee",
    name: "Puyallup Holiday Coffee Crawl",
    starts_at: "2026-11-01T07:00:00.000Z",
    ends_at: "2027-01-01T07:59:00.000Z",
    payment_link: PAYMENT_URL,
    price_cents: 4999,
    signup_key: "puy-coffee-nov-2026",
  };
}

function signupRow(overrides) {
  return {
    id: SIGNUP_ID,
    crawl: "puy-coffee-nov-2026",
    crawl_id: "puy-coffee",
    business_name: "Anthem Coffee",
    contact_name: "Bryan",
    email: "bryan@myanthemcoffee.com",
    phone: "2535550100",
    status: "started",
    stripe_session_id: null,
    paid_at: null,
    amount_cents: 4999,
    amount_paid_cents: null,
    ...overrides,
  };
}

function session(overrides) {
  return {
    id: "cs_test_ours",
    client_reference_id: SIGNUP_ID,
    payment_status: "paid",
    payment_link: "plink_coffee",
    amount_total: 4999,
    currency: "usd",
    customer_details: { email: "bryan@myanthemcoffee.com" },
    ...overrides,
  };
}

function depsFor(db, extras) {
  const emails = [];
  return {
    db,
    emails,
    deps: {
      supabase: db,
      allowlist: extras && extras.allowlist ? extras.allowlist : "",
      resendKey: "re_test",
      stripe: {
        paymentLinks: {
          retrieve: async (id) => ({ id, url: (extras && extras.linkUrl) || PAYMENT_URL }),
        },
        webhooks: extras && extras.webhooks,
      },
      fetch: async (url, options) => {
        emails.push({ url, body: JSON.parse(options.body), headers: options.headers });
        return { ok: true, status: 200, text: async () => "" };
      },
      webhookSecret: "whsec_test_secret",
    },
  };
}

test("formats the charged amount and crawl dates from data", () => {
  assert.equal(_test.formatAmount(4999, "usd"), "$49.99");
  assert.equal(_test.formatAmount(2500, "usd"), "$25.00");
  assert.equal(
    _test.formatCrawlDates("2026-11-01T07:00:00.000Z", "2027-01-01T07:59:00.000Z"),
    "Nov 1 – Dec 31, 2026"
  );
  const email = _test.buildEmail({
    crawlName: "Puyallup Holiday Coffee Crawl",
    dates: "Nov 1 – Dec 31, 2026",
    amount: "$49.99",
    businessName: "Anthem Coffee",
  });
  assert.equal(email.subject, "You're in: Puyallup Holiday Coffee Crawl");
  assert.match(email.html, /#1f3a24/);
  assert.match(email.html, /#f4efe6/);
  assert.match(email.html, /\$49\.99/);
  assert.match(email.html, /https:\/\/www\.hometowncrawls\.com\/puyallup\/coffee-crawl\/shop/);
  assert.match(email.html, /https:\/\/www\.hometowncrawls\.com\/puyallup\/holiday-coffee-crawl/);
});

test("payment link matches a crawl URL or the allowlist, not a foreign link", () => {
  assert.equal(
    _test.paymentLinkMatches({
      linkId: "plink_other",
      linkUrl: "https://buy.stripe.com/notours",
      crawlPaymentLinks: [PAYMENT_URL],
      allowlist: "",
    }),
    false
  );
  assert.equal(
    _test.paymentLinkMatches({
      linkId: "plink_coffee",
      linkUrl: PAYMENT_URL + "?prefilled_email=a@b.co",
      crawlPaymentLinks: [PAYMENT_URL],
      allowlist: "",
    }),
    true
  );
  assert.equal(
    _test.paymentLinkMatches({
      linkId: "plink_allow",
      linkUrl: "https://buy.stripe.com/somethingelse",
      crawlPaymentLinks: [PAYMENT_URL],
      allowlist: "plink_allow, plink_other",
    }),
    true
  );
});

test("ignores a foreign checkout session", async () => {
  const db = memorySupabase({ crawls: [crawlRow()], signups: [signupRow()] });
  const { deps } = depsFor(db, { linkUrl: "https://buy.stripe.com/foreignbusiness" });
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const result = await handleEvent(
      { type: "checkout.session.completed", data: { object: session({ id: "cs_foreign", client_reference_id: "11111111-1111-4111-8111-111111111111" }) } },
      deps
    );
    assert.equal(result.status, 200);
    assert.deepEqual(logs, ["[hc-webhook] ignoring foreign session cs_foreign"]);
    assert.equal(db.state.calls.length, 0);
  } finally {
    console.log = original;
  }
});

test("ignores our signup when the payment link is not ours", async () => {
  const db = memorySupabase({ crawls: [crawlRow()], signups: [signupRow()] });
  const { deps } = depsFor(db, { linkUrl: "https://buy.stripe.com/foreignbusiness" });
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const result = await handleEvent(
      { type: "checkout.session.completed", data: { object: session() } },
      deps
    );
    assert.equal(result.status, 200);
    assert.equal(logs[0], "[hc-webhook] ignoring foreign session cs_test_ours");
    assert.equal(db.state.signups[0].status, "started");
  } finally {
    console.log = original;
  }
});

test("does not mark an unpaid session", async () => {
  const db = memorySupabase({
    crawls: [crawlRow()],
    signups: [signupRow()],
    listings: [{ id: "listing-1", signup_id: SIGNUP_ID, is_paid: false, paid_at: null, stripe_session_id: null }],
  });
  const { deps, emails } = depsFor(db);
  const result = await handleEvent(
    { type: "checkout.session.completed", data: { object: session({ payment_status: "unpaid" }) } },
    deps
  );
  assert.equal(result.status, 200);
  assert.equal(emails.length, 0);
  assert.equal(db.state.signups[0].status, "started");
  assert.equal(db.state.listings[0].is_paid, false);
});

test("marks the signup and listing paid and emails once", async () => {
  const db = memorySupabase({
    crawls: [crawlRow()],
    signups: [signupRow()],
    listings: [{ id: "listing-1", signup_id: SIGNUP_ID, is_paid: false, paid_at: null, stripe_session_id: null, amount_paid_cents: null, payment_source: null }],
  });
  const { deps, emails } = depsFor(db);
  const event = {
    type: "checkout.session.async_payment_succeeded",
    data: { object: session({ amount_total: 2500 }) },
  };
  const first = await handleEvent(event, deps);
  assert.equal(first.status, 200);
  assert.equal(db.state.signups[0].status, "paid");
  assert.equal(db.state.signups[0].stripe_session_id, "cs_test_ours");
  assert.equal(db.state.signups[0].amount_paid_cents, 2500);
  assert.ok(db.state.signups[0].paid_at);
  assert.equal(db.state.listings[0].is_paid, true);
  assert.equal(db.state.listings[0].stripe_session_id, "cs_test_ours");
  assert.equal(db.state.listings[0].payment_source, "stripe");
  assert.equal(db.state.listings[0].amount_paid_cents, 2500);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].body.from, "Hometown Crawls <hello@hometowncrawls.com>");
  assert.equal(emails[0].body.subject, "You're in: Puyallup Holiday Coffee Crawl");
  assert.match(emails[0].body.html, /\$25\.00/);
  assert.equal(emails[0].headers["Idempotency-Key"], "hometown-crawls-paid-cs_test_ours");

  const updateOrder = db.state.calls.filter((call) => call.op === "update").map((call) => call.table);
  assert.deepEqual(updateOrder, ["crawl_signups", "shop_listings"]);

  const second = await handleEvent(event, deps);
  assert.equal(second.status, 200);
  assert.equal(emails.length, 1);
});

test("creates a missing listing the same way the signup trigger does", async () => {
  const db = memorySupabase({ crawls: [crawlRow()], signups: [signupRow()], listings: [] });
  const { deps, emails } = depsFor(db);
  const result = await handleEvent(
    { type: "checkout.session.completed", data: { object: session() } },
    deps
  );
  assert.equal(result.status, 200);
  assert.equal(db.state.listings.length, 1);
  assert.equal(db.state.listings[0].signup_id, SIGNUP_ID);
  assert.equal(db.state.listings[0].crawl_id, "puy-coffee");
  assert.equal(db.state.listings[0].owner_email, "bryan@myanthemcoffee.com");
  assert.equal(db.state.listings[0].display_name, "Anthem Coffee");
  assert.equal(db.state.listings[0].is_paid, true);
  assert.equal(emails.length, 1);
});

test("returns 500 when the database write fails", async () => {
  const stripe = stripeLib;
  const secret = "whsec_test_secret";
  const db = memorySupabase({
    crawls: [crawlRow()],
    signups: [signupRow()],
    listings: [{ id: "listing-1", signup_id: SIGNUP_ID, is_paid: false }],
  });
  const originalFrom = db.from.bind(db);
  db.from = (table) => {
    const query = originalFrom(table);
    if (table !== "crawl_signups") return query;
    const update = query.update.bind(query);
    query.update = (patch) => {
      const next = update(patch);
      next._run = () => Promise.resolve({ data: null, error: { message: "connection reset", code: "57014" } });
      return next;
    };
    return query;
  };
  const payload = JSON.stringify({
    id: "evt_fail",
    object: "event",
    type: "checkout.session.completed",
    data: { object: session() },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const buf = Buffer.from(payload);
  const { deps } = depsFor(db);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await handleRequest(
      {
        method: "POST",
        headers: { "stripe-signature": header },
        async *[Symbol.asyncIterator]() {
          yield buf;
        },
      },
      {
        ...deps,
        stripe: { ...deps.stripe, webhooks: stripe.webhooks },
        webhookSecret: secret,
      }
    );
    assert.equal(result.status, 500);
    assert.match(errors.join("\n"), /connection reset/);
    assert.equal(db.state.signups[0].status, "started");
  } finally {
    console.error = original;
  }
});

test("returns 400 for a bad signature and 200 for a verified foreign event", async () => {
  const stripe = stripeLib;
  const payload = JSON.stringify({
    id: "evt_test",
    object: "event",
    type: "checkout.session.completed",
    data: { object: session({ client_reference_id: "not-a-uuid", id: "cs_shared" }) },
  });
  const secret = "whsec_test_secret";
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const db = memorySupabase({ crawls: [], signups: [] });

  function request(raw, signature) {
    const buf = Buffer.from(raw);
    return {
      method: "POST",
      headers: { "stripe-signature": signature },
      async *[Symbol.asyncIterator]() {
        yield buf;
      },
    };
  }

  const bad = await handleRequest(request(payload, "t=1,v1=deadbeef"), {
    ...depsFor(db).deps,
    stripe,
    webhookSecret: secret,
  });
  assert.equal(bad.status, 400);

  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const ok = await handleRequest(request(payload, header), {
      ...depsFor(db).deps,
      stripe,
      webhookSecret: secret,
    });
    assert.equal(ok.status, 200);
    assert.equal(logs[0], "[hc-webhook] ignoring foreign session cs_shared");
  } finally {
    console.log = original;
  }
});

test("rejects a parsed JSON body so the signature cannot be checked against a re-serialized payload", async () => {
  await assert.rejects(
    () => _test.readRawBody({ body: { id: "evt" }, headers: {} }),
    (err) => err.code === "RAW_BODY"
  );
});
