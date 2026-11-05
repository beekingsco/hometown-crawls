const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const RATE = "Too many sign-in emails right now. Wait about a minute, then tap Send once.";

function loadCrawl(handler) {
  const sandbox = {
    URLSearchParams,
    location: { hash: "", search: "", pathname: "/account", origin: "https://www.hometowncrawls.com" },
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: {},
    document: {},
    handler: handler || (async () => ({ error: null }))
  };
  sandbox.window = sandbox;
  sandbox.__HC_ENV__ = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" };
  sandbox.supabase = {
    createClient() {
      return { auth: { signInWithOtp: (...args) => sandbox.handler(...args) } };
    }
  };
  vm.runInNewContext(read("assets/crawl.js"), sandbox, { filename: "assets/crawl.js" });
  return sandbox;
}

function el(extra) {
  const node = {
    value: "",
    checked: false,
    textContent: "",
    disabled: false,
    className: "",
    style: {},
    scrolls: [],
    attrs: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    setAttribute(name, value) { node.attrs[name] = value; },
    getAttribute(name) { return node.attrs[name]; },
    scrollIntoView(arg) { node.scrolls.push(arg === undefined ? true : arg); },
    addEventListener() {}
  };
  return Object.assign(node, extra || {});
}

function loadPaper(crawl) {
  const nodes = {
    "auth-name": el({ value: "Ada Lovelace" }),
    "auth-email": el({ value: "ada@example.com" }),
    "auth-phone": el({ value: "(253) 555-0100" }),
    "contact-consent": el({ checked: true }),
    "photo-promo-consent": el({ checked: true }),
    "area-crawl-opt-in": el(),
    "paper-terms": el(),
    "play-paper": el(),
    "btn-magic": el({ textContent: "Send magic link" }),
    "auth-msg": el(),
    "auth-err": el()
  };
  const shown = [];
  const sandbox = {
    URLSearchParams,
    location: { hash: "", search: "", pathname: "/account", origin: "https://www.hometowncrawls.com" },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    history: { replaceState() {} },
    document: {
      addEventListener() {},
      getElementById(id) { return nodes[id] || null; }
    },
    HCCrawl: {
      getSession: async () => null,
      magicLink: crawl.HCCrawl.magicLink,
      otpErrorMessage: crawl.HCCrawl.otpErrorMessage,
      revealNotice(node) {
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior: "smooth", block: "nearest" });
      },
      client() { return null; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/paper-card.js"), sandbox, { filename: "assets/paper-card.js" });
  function show(node, on) {
    shown.push({ id: Object.keys(nodes).find((key) => nodes[key] === node), on, text: node.textContent });
    node.style.display = on ? "block" : "none";
    if (on) sandbox.HCCrawl.revealNotice(node);
  }
  return { sandbox, nodes, shown, show };
}

test("rate-limit OTP failures use the friendly sign-in copy", () => {
  const crawl = loadCrawl();
  const message = crawl.HCCrawl.otpErrorMessage;
  const cases = [
    { status: 429, message: "email rate limit exceeded", code: "over_email_send_rate_limit" },
    { status: 429, message: "Request rate limit reached" },
    { statusCode: 429, message: "Too Many Requests" },
    { code: "over_email_send_rate_limit", message: "please wait" },
    { message: "Email rate limit exceeded" },
    "email rate limit exceeded"
  ];
  for (const error of cases) assert.equal(message(error), RATE);
  assert.equal(message({ message: "Unable to validate email address: invalid format", status: 400 }), "Unable to validate email address: invalid format");
  assert.equal(message({ msg: "User already registered" }), "User already registered");
  assert.equal(message(null), "Could not send the sign-in link.");
});

test("magicLink throws the friendly error when signInWithOtp returns or throws 429", async () => {
  const returned = loadCrawl(async () => ({
    error: { message: "email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" }
  }));
  await assert.rejects(returned.HCCrawl.magicLink("ada@example.com"), (error) => {
    assert.equal(error.message, RATE);
    assert.equal(error.status, 429);
    assert.equal(error.code, "over_email_send_rate_limit");
    return true;
  });

  const thrown = loadCrawl(async () => {
    const error = new Error("email rate limit exceeded");
    error.status = 429;
    error.code = "over_email_send_rate_limit";
    throw error;
  });
  await assert.rejects(thrown.HCCrawl.magicLink("ada@example.com"), (error) => {
    assert.equal(error.message, RATE);
    return true;
  });

  const other = loadCrawl(async () => ({ error: { message: "Unable to validate email address: invalid format", status: 400 } }));
  await assert.rejects(other.HCCrawl.magicLink("ada@example.com"), (error) => {
    assert.equal(error.message, "Unable to validate email address: invalid format");
    return true;
  });
});

test("guest submit surfaces a forced OTP failure, scrolls it, and disables Send while waiting", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const crawl = loadCrawl();
  const page = loadPaper(crawl);
  let inflight = null;
  crawl.magicLink = async () => {
    calls += 1;
    inflight = {
      disabled: page.nodes["btn-magic"].disabled,
      text: page.nodes["btn-magic"].textContent
    };
    await gate;
    const error = new Error("email rate limit exceeded");
    error.status = 429;
    error.code = "over_email_send_rate_limit";
    throw error;
  };
  page.sandbox.HCCrawl.magicLink = crawl.magicLink;

  const pending = page.sandbox.HCPaper.submit({ show: page.show, msg: page.nodes["auth-msg"], err: page.nodes["auth-err"] });
  const ignored = page.sandbox.HCPaper.submit({ show: page.show, msg: page.nodes["auth-msg"], err: page.nodes["auth-err"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.deepEqual(inflight, { disabled: true, text: "Sending…" });
  release();
  await Promise.all([pending, ignored]);

  assert.equal(page.nodes["auth-err"].textContent, RATE);
  assert.equal(page.nodes["auth-err"].style.display, "block");
  assert.equal(page.nodes["btn-magic"].disabled, false);
  assert.equal(page.nodes["btn-magic"].textContent, "Send magic link");
  assert.equal(page.nodes["auth-err"].scrolls.length > 0, true);
  assert.equal(page.nodes["auth-err"].scrolls.at(-1).behavior, "smooth");
  assert.equal(page.nodes["auth-msg"].textContent, "");
});

test("validation errors scroll into view and do not start a send", async () => {
  let calls = 0;
  const crawl = loadCrawl();
  const page = loadPaper(crawl);
  page.nodes["auth-name"].value = "";
  page.sandbox.HCCrawl.magicLink = async () => { calls += 1; };
  await page.sandbox.HCPaper.submit({ show: page.show, msg: page.nodes["auth-msg"], err: page.nodes["auth-err"] });
  assert.equal(page.nodes["auth-err"].textContent, "Enter your name.");
  assert.equal(page.nodes["auth-err"].scrolls.length > 0, true);
  assert.equal(page.nodes["btn-magic"].disabled, false);
  assert.equal(page.nodes["btn-magic"].textContent, "Send magic link");
  assert.equal(calls, 0);
});

test("guest pages keep the rate-limit notice next to Send", () => {
  const account = read("account.html");
  const puyallup = read("puyallup/holiday-coffee-crawl/index.html");
  const arlington = read("arlington/holiday-coffee-crawl/index.html");
  const paper = read("assets/paper-card.js");
  assert.match(account, /id="auth-err" role="alert"/);
  assert.match(account, /HCCrawl\.revealNotice/);
  assert.match(account, /otpErrorMessage/);
  assert.match(paper, /catch \(e\)/);
  assert.match(paper, /button\.disabled = !!on/);
  assert.match(paper, /Sending…/);
  for (const page of [puyallup, arlington]) {
    assert.match(page, /HCCrawl\.magicLink\(email, CRAWL\)/);
    assert.match(page, /HCCrawl\.otpErrorMessage/);
    assert.match(page, /HCCrawl\.revealNotice/);
    assert.match(page, /button\.disabled = true/);
    assert.match(page, /Sending…/);
    assert.doesNotMatch(page, /sb\.auth\.signInWithOtp/);
  }
  assert.doesNotMatch(read("assets/crawl.js"), /c_radius/);
});
