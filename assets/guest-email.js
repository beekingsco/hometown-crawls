/* Guest sign-in email helpers.
   Warn before a magic link when the address looks like Apple Hide My Email,
   and remember the last email that actually sent on this device.
   This does not block the send and does not change crawl join. */
(function () {
  var STORAGE_KEY = "hc-last-guest-email";
  var COPY = "Heads up! That looks like a hidden iCloud email your phone made up. If you've played before, use the email you signed up with so your stamps show up. Want to keep this one anyway?";
  var FIELD_IDS = ["auth-email", "magic-email", "stamp-fix-email"];
  var tracked = [];

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function normalize(email) {
    return String(email || "").trim().toLowerCase();
  }

  function parts(email) {
    var value = normalize(email);
    var at = value.indexOf("@");
    if (at <= 0 || at !== value.lastIndexOf("@")) return null;
    var local = value.slice(0, at);
    var domain = value.slice(at + 1);
    if (!local || !domain || domain.indexOf(".") === -1) return null;
    if (/[\s<>]/.test(value)) return null;
    return { email: local + "@" + domain, local: local, domain: domain };
  }

  // icloud.com Hide My Email looks like two lowercase words, a dot or
  // underscore, then a short suffix that starts with a digit and includes
  // a letter: deluxe.wizard7u, word_word0x. Names like jane.doe or
  // mary.smith2 stay clear.
  function isHideMyEmailLocal(local) {
    var match = String(local || "").match(/^([a-z]{3,20})[._]([a-z]{3,20})(\d[a-z0-9]{1,3})$/);
    if (!match) return false;
    return /[a-z]/.test(match[3]);
  }

  function isRelay(email) {
    var parsed = parts(email);
    if (!parsed) return false;
    if (parsed.domain === "privaterelay.appleid.com") return true;
    if (parsed.domain !== "icloud.com") return false;
    return isHideMyEmailLocal(parsed.local);
  }

  function lastEmail() {
    var store = storage();
    if (!store) return "";
    try {
      var parsed = parts(store.getItem(STORAGE_KEY) || "");
      return parsed ? parsed.email : "";
    } catch (e) {
      return "";
    }
  }

  function suggestionText(email) {
    return "Last time you used " + email;
  }

  function fieldAnchor(input) {
    if (input && typeof input.closest === "function") {
      var label = input.closest("label");
      if (label) return label;
    }
    return input;
  }

  function insertAfter(anchor, node) {
    if (anchor && typeof anchor.insertAdjacentElement === "function") {
      anchor.insertAdjacentElement("afterend", node);
      return;
    }
    if (anchor && anchor.parentNode && typeof anchor.parentNode.appendChild === "function") {
      anchor.parentNode.appendChild(node);
    }
  }

  function focusField(input) {
    if (!input || typeof input.focus !== "function") return;
    var run = function () {
      try { input.focus(); } catch (e) {}
      if (typeof input.select === "function") {
        try { input.select(); } catch (e2) {}
      }
    };
    run();
    if (typeof setTimeout === "function") setTimeout(run, 0);
  }

  function reveal(node) {
    if (window.HCCrawl && typeof HCCrawl.revealNotice === "function") HCCrawl.revealNotice(node);
  }

  function ensureSuggestion(input) {
    var saved = lastEmail();
    if (!saved || !input) return;
    var button = input._hcSuggestion;
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "last-email-suggestion";
      button.addEventListener("click", function (ev) {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        var current = lastEmail();
        if (!current) return;
        input.value = current;
        button.textContent = suggestionText(current);
        try {
          if (typeof input.dispatchEvent === "function" && typeof Event === "function") {
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } catch (e) {}
        focusField(input);
      });
      input._hcSuggestion = button;
      var note = input._hcRelayNote;
      insertAfter(fieldAnchor(input), button);
      if (note && note.parentNode) insertAfter(button, note);
    }
    button.textContent = suggestionText(saved);
    if (button.classList) button.classList.remove("hidden");
  }

  function remember(email) {
    var parsed = parts(email);
    if (!parsed) return;
    var store = storage();
    if (store) {
      try { store.setItem(STORAGE_KEY, parsed.email); } catch (e) {}
    }
    tracked.forEach(ensureSuggestion);
  }

  function attach(input) {
    if (!input || input._hcEmailAttached) return;
    input._hcEmailAttached = true;
    tracked.push(input);
    if (!String(input.value || "").trim() && lastEmail()) input.value = lastEmail();
    ensureSuggestion(input);
  }

  function hideNote(input) {
    var note = input && input._hcRelayNote;
    if (note && note.classList) note.classList.add("hidden");
  }

  function ensureNote(input) {
    if (input._hcRelayNote) return input._hcRelayNote;
    var note = document.createElement("div");
    note.className = "relay-email-note hidden";
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    var copy = document.createElement("p");
    copy.textContent = COPY;
    var actions = document.createElement("div");
    actions.className = "relay-email-actions";
    var change = document.createElement("button");
    change.type = "button";
    change.className = "btn btn-primary";
    change.textContent = "Use a different email";
    var keep = document.createElement("button");
    keep.type = "button";
    keep.className = "btn btn-ghost";
    keep.textContent = "Keep this email";
    actions.appendChild(change);
    actions.appendChild(keep);
    note.appendChild(copy);
    note.appendChild(actions);
    input._hcRelayNote = note;
    input._hcRelayChange = change;
    input._hcRelayKeep = keep;
    var suggestion = input._hcSuggestion;
    insertAfter(suggestion && suggestion.parentNode ? suggestion : fieldAnchor(input), note);
    return note;
  }

  function finishPending(input, ok, opts) {
    var pending = input && input._hcRelayPending;
    if (!pending) return;
    opts = opts || {};
    input._hcRelayPending = null;
    if (typeof pending.cleanup === "function") pending.cleanup();
    hideNote(input);
    if (!ok && opts.focus) focusField(input);
    pending.resolve(!!ok);
  }

  function confirm(input) {
    if (!input) return Promise.resolve(true);
    var email = input.value || "";
    if (!isRelay(email)) {
      finishPending(input, false);
      hideNote(input);
      return Promise.resolve(true);
    }
    if (typeof document === "undefined" || typeof document.createElement !== "function" || typeof input.addEventListener !== "function") {
      return Promise.resolve(true);
    }
    if (input._hcRelayPending && input._hcRelayPending.email === normalize(email)) {
      return input._hcRelayPending.promise;
    }
    finishPending(input, false);
    var note = ensureNote(input);
    if (note.classList) note.classList.remove("hidden");
    reveal(note);
    var settled = false;
    var pending = {
      email: normalize(email),
      resolve: function () {},
      cleanup: function () {}
    };
    var promise = new Promise(function (resolve) {
      pending.resolve = function (ok) {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
    });
    pending.promise = promise;
    input._hcRelayPending = pending;

    function onKeep(ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      finishPending(input, true);
    }
    function onChange(ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      finishPending(input, false, { focus: true });
    }
    function onInput() {
      if (normalize(input.value || "") !== pending.email) finishPending(input, false);
    }
    pending.cleanup = function () {
      input._hcRelayKeep.removeEventListener("click", onKeep);
      input._hcRelayChange.removeEventListener("click", onChange);
      input.removeEventListener("input", onInput);
    };
    input._hcRelayKeep.addEventListener("click", onKeep);
    input._hcRelayChange.addEventListener("click", onChange);
    input.addEventListener("input", onInput);
    return promise;
  }

  function mountAll() {
    if (!document || typeof document.getElementById !== "function") return;
    FIELD_IDS.forEach(function (id) {
      var input = document.getElementById(id);
      if (input) attach(input);
    });
  }

  if (typeof document !== "undefined" && document && typeof document.addEventListener === "function") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
    else mountAll();
  }

  window.HCGuestEmail = {
    STORAGE_KEY: STORAGE_KEY,
    COPY: COPY,
    isRelay: isRelay,
    lastEmail: lastEmail,
    remember: remember,
    suggestionText: suggestionText,
    attach: attach,
    confirm: confirm
  };
})();
