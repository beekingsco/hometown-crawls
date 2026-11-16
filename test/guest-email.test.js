const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

function makeNode(tag) {
  const node = {
    tag: tag,
    type: "",
    value: "",
    className: "",
    textContent: "",
    parentNode: null,
    children: [],
    attrs: {},
    listeners: [],
    focused: 0,
    selected: 0
  };
  node.classList = {
    add(name) {
      const parts = node.className.split(/\s+/).filter(Boolean);
      if (!parts.includes(name)) parts.push(name);
      node.className = parts.join(" ");
    },
    remove(name) {
      node.className = node.className.split(/\s+/).filter((part) => part && part !== name).join(" ");
    },
    contains(name) {
      return node.className.split(/\s+/).includes(name);
    }
  };
  node.setAttribute = (name, value) => { node.attrs[name] = value; };
  node.appendChild = (child) => {
    child.parentNode = node;
    node.children.push(child);
    return child;
  };
  node.insertAdjacentElement = (position, child) => {
    const parent = node.parentNode;
    if (!parent) return child;
    const existing = parent.children.indexOf(child);
    if (existing !== -1) parent.children.splice(existing, 1);
    const index = parent.children.indexOf(node);
    const at = position === "afterend" ? index + 1 : index;
    parent.children.splice(at, 0, child);
    child.parentNode = parent;
    return child;
  };
  node.addEventListener = (type, fn) => { node.listeners.push({ type: type, fn: fn }); };
  node.removeEventListener = (type, fn) => {
    node.listeners = node.listeners.filter((row) => row.type !== type || row.fn !== fn);
  };
  node.dispatchEvent = (ev) => {
    node.listeners.filter((row) => row.type === ev.type).forEach((row) => row.fn(ev));
    return true;
  };
  node.click = () => {
    node.listeners.filter((row) => row.type === "click").forEach((row) => row.fn({ type: "click", preventDefault() {} }));
  };
  node.focus = () => { node.focused += 1; };
  node.select = () => { node.selected += 1; };
  node.closest = (sel) => {
    let cur = node;
    while (cur) {
      if (sel === "label" && cur.tag === "label") return cur;
      cur = cur.parentNode;
    }
    return null;
  };
  return node;
}

function loadGuest(storage) {
  const sandbox = {
    URLSearchParams,
    Event,
    setTimeout,
    localStorage: storage || memoryStorage(),
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById() { return null; },
      createElement(tag) { return makeNode(tag); }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/guest-email.js"), sandbox, { filename: "assets/guest-email.js" });
  return sandbox;
}

function emailField(value) {
  const form = makeNode("form");
  const label = makeNode("label");
  const input = makeNode("input");
  input.value = value || "";
  form.appendChild(label);
  label.appendChild(input);
  return input;
}

function noteFor(input) {
  const label = input.parentNode;
  return label.parentNode.children.find((node) => node !== label && node.className.indexOf("relay-email-note") !== -1);
}

test("relay heuristic flags Hide My Email and leaves normal icloud addresses alone", () => {
  const guest = loadGuest().HCGuestEmail;
  const flagged = [
    "deluxe.wizard7u@icloud.com",
    "word.word7u@icloud.com",
    "word_word0x@icloud.com",
    "happy_cat4k@icloud.com",
    "sparkling.river4k@icloud.com",
    "Deluxe.Wizard7U@iCloud.com",
    "anything@privaterelay.appleid.com",
    "deluxe.wizard7u@privaterelay.appleid.com",
    "Person@PrivateRelay.AppleID.com"
  ];
  const clear = [
    "ada@example.com",
    "jane.doe@icloud.com",
    "john.smith@icloud.com",
    "mary_jones@icloud.com",
    "mary.smith2@icloud.com",
    "coach.mike12@icloud.com",
    "first.last@icloud.com",
    "my.email@icloud.com",
    "sam@icloud.com",
    "ab.wizard7u@icloud.com",
    "deluxe.wizard7u@gmail.com",
    "deluxe.wizard@icloud.com",
    "hide.my.email7u@icloud.com",
    "user@me.com",
    "user@mac.com",
    "user@privaterelay.appleid.com.evil.com",
    "not an email",
    "@privaterelay.appleid.com",
    "bryan@myanthemcoffee.com"
  ];
  for (const email of flagged) assert.equal(guest.isRelay(email), true, email);
  for (const email of clear) assert.equal(guest.isRelay(email), false, email);
  assert.doesNotMatch(guest.COPY, /\u2014|\u2013/);
  assert.doesNotMatch(guest.suggestionText("ada@example.com"), /\u2014|\u2013/);
  assert.equal(
    guest.COPY,
    "Heads up! That looks like a hidden iCloud email your phone made up. If you've played before, use the email you signed up with so your stamps show up. Want to keep this one anyway?"
  );
});

test("last email is remembered, prefilled, and offered as a tappable suggestion", () => {
  const sandbox = loadGuest();
  const guest = sandbox.HCGuestEmail;
  const input = emailField("already@example.com");
  guest.attach(input);
  assert.equal(input.value, "already@example.com");
  assert.equal(input._hcSuggestion, undefined);

  guest.remember("Ada@Example.com");
  assert.equal(guest.lastEmail(), "ada@example.com");
  assert.equal(sandbox.localStorage.getItem(guest.STORAGE_KEY), "ada@example.com");
  assert.equal(input._hcSuggestion.textContent, "Last time you used ada@example.com");
  assert.equal(input._hcSuggestion.type, "button");

  const fresh = emailField("  ");
  guest.attach(fresh);
  assert.equal(fresh.value, "ada@example.com");
  fresh.value = "other@example.com";
  fresh._hcSuggestion.click();
  assert.equal(fresh.value, "ada@example.com");
  assert.equal(fresh.focused > 0, true);

  guest.remember("not-an-email");
  assert.equal(guest.lastEmail(), "ada@example.com");
});

test("relay warning is soft: a different email focuses the field, Keep allows the send", async () => {
  const guest = loadGuest().HCGuestEmail;
  const input = emailField("deluxe.wizard7u@icloud.com");
  let focusedBefore = input.focused;
  const pending = guest.confirm(input);
  const again = guest.confirm(input);
  assert.equal(pending, again);
  const note = noteFor(input);
  assert.equal(note.classList.contains("hidden"), false);
  assert.equal(note.attrs.role, "status");
  assert.equal(note.children[0].textContent, guest.COPY);
  const change = input._hcRelayChange;
  const keep = input._hcRelayKeep;
  assert.equal(change.textContent, "Use a different email");
  assert.equal(keep.textContent, "Keep this email");
  assert.equal(change.type, "button");
  assert.equal(keep.type, "button");
  change.click();
  assert.equal(await pending, false);
  assert.equal(note.classList.contains("hidden"), true);
  assert.equal(input.focused > focusedBefore, true);
  assert.equal(input.selected > 0, true);

  const kept = guest.confirm(input);
  input._hcRelayKeep.click();
  assert.equal(await kept, true);

  const normal = emailField("jane.doe@icloud.com");
  assert.equal(await guest.confirm(normal), true);
  assert.equal(normal._hcRelayNote, undefined);
});

test("editing the address dismisses the warning instead of sending the old one", async () => {
  const guest = loadGuest().HCGuestEmail;
  const input = emailField("word_word0x@icloud.com");
  const pending = guest.confirm(input);
  input.value = "jane.doe@icloud.com";
  input.dispatchEvent({ type: "input" });
  assert.equal(await pending, false);
  assert.equal(await guest.confirm(input), true);
});

test("guest sign-in pages load the helper and still send through the existing magic link", () => {
  const pages = [
    "account.html",
    "stamp-fix/index.html",
    "puyallup/holiday-coffee-crawl/index.html",
    "arlington/holiday-coffee-crawl/index.html"
  ];
  for (const rel of pages) {
    const html = read(rel);
    assert.match(html, /guest-email\.js\?v=hide-email-1/, rel);
    assert.match(html, /site\.css\?v=hide-email-1/, rel);
  }
  assert.match(read("account.html"), /paper-card\.js\?v=hide-email-1/);
  assert.match(read("stamp-fix/index.html"), /stamp-fix\.js\?v=stamp-fix-4/);
  assert.match(read("assets/paper-card.js"), /HCGuestEmail\.confirm/);
  assert.match(read("assets/paper-card.js"), /HCCrawl\.magicLink\(row\.email\)/);
  assert.doesNotMatch(read("assets/paper-card.js"), /magicLink\(row\.email,/);
  assert.match(read("assets/stamp-fix.js"), /HCCrawl\.magicLink\(\(email && email\.value \|\| ""\)\.trim\(\), crawlId\)/);
  for (const rel of [
    "puyallup/holiday-coffee-crawl/index.html",
    "arlington/holiday-coffee-crawl/index.html"
  ]) {
    const html = read(rel);
    assert.match(html, /HCCrawl\.magicLink\(email, CRAWL\)/);
    assert.match(html, /button\[type='submit'\]/);
  }
  for (const rel of [
    "puyallup/coffee-crawl/organizer/index.html",
    "puyallup/coffee-crawl/shop/index.html",
    "puyallup/coffee-crawl/shop/card/index.html"
  ]) {
    assert.doesNotMatch(read(rel), /guest-email\.js/, rel);
  }
  assert.match(read("assets/site.css"), /\.relay-email-note/);
  assert.match(read("assets/site.css"), /\.last-email-suggestion/);
  assert.doesNotMatch(read("assets/guest-email.js"), /\u2014|\u2013/);
});

test("account signup waits for Keep before magicLink and does not pass a crawl id", async () => {
  const calls = [];
  const nodes = {};
  const form = makeNode("form");
  function field(id, value) {
    const label = makeNode("label");
    const input = makeNode("input");
    input.value = value || "";
    label.appendChild(input);
    form.appendChild(label);
    nodes[id] = input;
    return input;
  }
  field("auth-name", "Ada");
  field("auth-email", "deluxe.wizard7u@icloud.com");
  field("auth-phone", "(253) 555-0100");
  nodes["contact-consent"] = makeNode("input");
  nodes["contact-consent"].checked = true;
  nodes["photo-promo-consent"] = makeNode("input");
  nodes["photo-promo-consent"].checked = true;
  nodes["area-crawl-opt-in"] = makeNode("input");
  nodes["paper-terms"] = makeNode("input");
  nodes["play-paper"] = makeNode("input");
  nodes["btn-magic"] = makeNode("button");
  nodes["btn-magic"].textContent = "Send magic link";
  nodes["auth-msg"] = makeNode("p");
  nodes["auth-err"] = makeNode("p");
  const sandbox = {
    URLSearchParams,
    Event,
    setTimeout,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    history: { replaceState() {} },
    location: { search: "", pathname: "/account", origin: "https://www.hometowncrawls.com" },
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById(id) { return nodes[id] || null; },
      createElement(tag) { return makeNode(tag); }
    },
    HCCrawl: {
      getSession: async () => null,
      magicLink(email, crawlId) {
        calls.push({ email: email, crawlId: crawlId, args: arguments.length });
      },
      otpErrorMessage(error) { return error && error.message; },
      revealNotice() {},
      client() { return null; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/guest-email.js"), sandbox, { filename: "assets/guest-email.js" });
  vm.runInNewContext(read("assets/paper-card.js"), sandbox, { filename: "assets/paper-card.js" });
  const show = () => {};

  const declined = sandbox.HCPaper.submit({ show: show, msg: nodes["auth-msg"], err: nodes["auth-err"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 0);
  assert.equal(noteFor(nodes["auth-email"]).classList.contains("hidden"), false);
  nodes["auth-email"]._hcRelayChange.click();
  await declined;
  assert.equal(calls.length, 0);
  assert.equal(nodes["btn-magic"].textContent, "Send magic link");

  const kept = sandbox.HCPaper.submit({ show: show, msg: nodes["auth-msg"], err: nodes["auth-err"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  nodes["auth-email"]._hcRelayKeep.click();
  await kept;
  assert.deepEqual(calls, [{ email: "deluxe.wizard7u@icloud.com", crawlId: undefined, args: 1 }]);
  assert.equal(sandbox.localStorage.getItem("hc-last-guest-email"), "deluxe.wizard7u@icloud.com");

  calls.length = 0;
  nodes["auth-email"].value = "jane.doe@icloud.com";
  await sandbox.HCPaper.submit({ show: show, msg: nodes["auth-msg"], err: nodes["auth-err"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "jane.doe@icloud.com");
  assert.equal(calls[0].args, 1);
});
