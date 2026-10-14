/* Organizer tab. Demo mode shows Bryan's crawls with labeled sample data.
   Invite links are created locally in the demo and are not emailed. */
(function () {
  var KEY = "hc-organizer-demo";

  function fixture() {
    return (window.__HC_ENV__ && window.__HC_ENV__.DEMO_ORGANIZER) || null;
  }

  function demoOn() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function esc(value) {
    return window.HCStoreDemo && HCStoreDemo.esc ? HCStoreDemo.esc(value) : String(value || "");
  }

  function loadState(base) {
    var state = {
      active: base.crawls[0].id,
      crawls: JSON.parse(JSON.stringify(base.crawls)),
      invites: []
    };
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Array.isArray(saved.crawls)) {
        saved.crawls.forEach(function (row) {
          var match = state.crawls.filter(function (c) { return c.id === row.id; })[0];
          if (!match) return;
          if (row.title) match.title = String(row.title).slice(0, 120);
          if (row.starts) match.starts = row.starts;
          if (row.ends) match.ends = row.ends;
          if (Array.isArray(row.stores)) {
            row.stores.forEach(function (saved) {
              var shop = (match.stores || []).filter(function (item) { return item.name === saved.name; })[0];
              if (shop && saved.visible === false) shop.visible = false;
            });
          }
        });
      }
      if (saved && Array.isArray(saved.invites)) state.invites = saved.invites;
      if (saved && saved.active && state.crawls.some(function (c) { return c.id === saved.active; })) state.active = saved.active;
    } catch (e) {}
    return state;
  }

  function saveState(state) {
    localStorage.setItem(KEY, JSON.stringify({
      active: state.active,
      crawls: state.crawls.map(function (c) {
        return {
          id: c.id,
          title: c.title,
          starts: c.starts,
          ends: c.ends,
          stores: (c.stores || []).map(function (row) { return { name: row.name, visible: row.visible !== false }; })
        };
      }),
      invites: state.invites
    }));
  }

  function activeCrawl(state) {
    return state.crawls.filter(function (c) { return c.id === state.active; })[0] || state.crawls[0];
  }

  function guestsFor(crawl) {
    var store = window.__HC_ENV__ && window.__HC_ENV__.DEMO_STORE;
    var rows = (store && store.guests) || [];
    return rows.filter(function (row) { return row && row.consentedAt; }).map(function (row) {
      return {
        name: row.name,
        email: row.email,
        crawlsJoined: crawl.title,
        stamps: row.stamps,
        consentedAt: row.consentedAt
      };
    });
  }

  function render(state, person) {
    var crawl = activeCrawl(state);
    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.innerHTML = state.crawls.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.title) + "</option>";
      }).join("");
      picker.value = crawl.id;
    }
    var title = document.getElementById("org-title");
    var start = document.getElementById("org-start");
    var end = document.getElementById("org-end");
    if (title && document.activeElement !== title) title.value = crawl.title || "";
    if (start && document.activeElement !== start) start.value = crawl.starts || "";
    if (end && document.activeElement !== end) end.value = crawl.ends || "";
    var who = document.getElementById("org-who");
    if (who) who.textContent = person.name + " · " + person.email + " · " + person.role;

    var stores = crawl.stores || [];
    var scans = stores.reduce(function (sum, row) { return sum + Number(row.scans || 0); }, 0);
    var paid = stores.filter(function (row) { return row.paid; }).length;
    var set = function (id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };
    set("org-total-stores", stores.length);
    set("org-total-paid", paid);
    set("org-total-unpaid", stores.length - paid);
    set("org-total-scans", scans);

    var list = document.getElementById("org-stores");
    if (list) {
      list.innerHTML = stores.map(function (row) {
        var pay = row.paid
          ? '<span class="pill pill-ok">Paid</span>'
          : '<span class="pill pill-wait">Unpaid</span>';
        var shown = row.visible !== false;
        return '<article class="record-card"><b class="record-name">' + esc(row.name) + '</b><p class="record-email">' +
          esc(row.code) + ' · ' + esc(row.scans) + ' scans · DEMO DATA</p><div class="record-chips">' + pay +
          '</div><label class="check"><input type="checkbox" data-visible="' + esc(row.name) + '"' +
          (shown ? " checked" : "") + "> Show on the passport</label></article>";
      }).join("");
    }

    var people = document.getElementById("co-list");
    if (people) {
      var mine = '<article class="record-card"><b class="record-name">Chris Miller</b><p class="record-email">chris@beekings.com</p><span class="chip">owner</span></article>' +
        '<article class="record-card"><b class="record-name">' + esc(person.name) + '</b><p class="record-email">' +
        esc(person.email) + '</p><span class="chip">' + esc(person.role) + "</span></article>" +
        '<article class="record-card"><b class="record-name">Contributor</b><p class="record-email">No store required. The migration does not replace the owner.</p><span class="chip">contributor</span></article>';
      var pending = state.invites.filter(function (row) { return row.crawlId === crawl.id; }).map(function (row) {
        return '<article class="guest-card"><b>' + esc(row.email) + '</b><div class="row mt-1"><span class="pill pill-wait">Pending invite</span><span class="pill pill-muted">co-organizer</span></div><p class="small mt-1" style="overflow-wrap:anywhere">' +
          esc(row.link) + "</p></article>";
      }).join("");
      people.innerHTML = mine + pending;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var base = fixture();
    if (!base || !demoOn() || !document.getElementById("panel-organizer")) return;
    var state = loadState(base);
    render(state, base.person);

    var storeList = document.getElementById("org-stores");
    if (storeList) {
      storeList.addEventListener("change", function (ev) {
        var box = ev.target.closest && ev.target.closest("[data-visible]");
        if (!box) return;
        var crawl = activeCrawl(state);
        (crawl.stores || []).forEach(function (row) {
          if (row.name === box.getAttribute("data-visible")) row.visible = box.checked;
        });
        saveState(state);
      });
    }

    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.onchange = function () {
        state.active = picker.value;
        saveState(state);
        render(state, base.person);
      };
    }

    var details = document.getElementById("org-details");
    if (details) {
      details.onsubmit = function (ev) {
        ev.preventDefault();
        var crawl = activeCrawl(state);
        var title = document.getElementById("org-title").value.trim();
        var start = document.getElementById("org-start").value;
        var end = document.getElementById("org-end").value;
        var err = document.getElementById("org-err");
        var ok = document.getElementById("org-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        if (!title || title.length > 120) {
          if (err) { err.textContent = "Title needs 1–120 characters."; err.classList.add("show"); }
          return;
        }
        if (!start || !end || end < start) {
          if (err) { err.textContent = "End date needs to be on or after the start date."; err.classList.add("show"); }
          return;
        }
        crawl.title = title;
        crawl.starts = start;
        crawl.ends = end;
        saveState(state);
        render(state, base.person);
        if (ok) { ok.textContent = "DEMO DATA. Title and dates saved in this browser only."; ok.classList.add("show"); }
        if (window.HC) HC.toast("Crawl details saved");
      };
    }

    var csv = document.getElementById("btn-org-csv");
    if (csv) {
      csv.onclick = function () {
        var crawl = activeCrawl(state);
        if (window.HCStoreDemo) HCStoreDemo.downloadGuests(guestsFor(crawl), crawl.id);
        if (window.HC) HC.toast("Guest CSV downloaded");
      };
    }

    var invite = document.getElementById("co-invite-form");
    if (invite) {
      invite.onsubmit = function (ev) {
        ev.preventDefault();
        var email = document.getElementById("co-email").value.trim().toLowerCase();
        var err = document.getElementById("co-err");
        var ok = document.getElementById("co-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (err) { err.textContent = "Enter a valid email address."; err.classList.add("show"); }
          return;
        }
        var token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, "") : String(Date.now());
        var link = location.origin + "/account?tab=organizer&demo=1&invite=" + token;
        state.invites.push({ crawlId: activeCrawl(state).id, email: email, token: token, link: link, role: "co-organizer" });
        saveState(state);
        document.getElementById("co-email").value = "";
        render(state, base.person);
        if (ok) {
          ok.textContent = "Invite recorded for " + email + ". Nothing was emailed. Share the link yourself.";
          ok.classList.add("show");
        }
        if (window.HC) HC.toast("Invite link ready");
      };
    }

    var params = new URLSearchParams(location.search);
    if (params.get("invite")) {
      var banner = document.getElementById("org-invite-banner");
      if (banner) {
        banner.classList.remove("hidden");
        banner.textContent = "DEMO DATA. This invite link is recorded only. No email was sent, and it does not change live organizer access.";
      }
    }
  });

  function dateOnly(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (demoOn() || !document.getElementById("panel-organizer") || !window.HCCrawl || !HCCrawl.client) return;
    var crawls = [];
    var shops = [];
    var team = [];
    var active = "";

    function showTab() {
      var tabs = document.getElementById("role-tabs");
      var btn = document.getElementById("tab-organizer");
      if (tabs) tabs.classList.remove("hidden");
      if (btn) btn.classList.remove("hidden");
    }

    function current() {
      return crawls.filter(function (row) { return row.crawl_id === active; })[0] || crawls[0];
    }

    function renderLive() {
      var crawl = current();
      if (!crawl) return;
      active = crawl.crawl_id;
      var picker = document.getElementById("org-crawl");
      if (picker) {
        picker.innerHTML = crawls.map(function (row) {
          return '<option value="' + esc(row.crawl_id) + '">' + esc(row.name) + "</option>";
        }).join("");
        picker.value = active;
      }
      var title = document.getElementById("org-title");
      var start = document.getElementById("org-start");
      var end = document.getElementById("org-end");
      if (title && document.activeElement !== title) title.value = crawl.name || "";
      if (start && document.activeElement !== start) start.value = dateOnly(crawl.starts_at);
      if (end && document.activeElement !== end) end.value = dateOnly(crawl.ends_at);
      var who = document.getElementById("org-who");
      if (who) who.textContent = (crawl.role || "organizer") + " · shop fees are not split";
      var scans = shops.reduce(function (sum, row) { return sum + Number(row.scans || 0); }, 0);
      var paid = shops.filter(function (row) { return row.is_paid; }).length;
      ["org-total-stores", "org-total-paid", "org-total-unpaid", "org-total-scans"].forEach(function (id, index) {
        var el = document.getElementById(id);
        var values = [shops.length, paid, shops.length - paid, scans];
        if (el) el.textContent = String(values[index]);
      });
      var list = document.getElementById("org-stores");
      if (list) {
        list.innerHTML = shops.map(function (row) {
          var pay = row.is_paid ? '<span class="pill pill-ok">Paid</span>' : '<span class="pill pill-wait">Unpaid</span>';
          return '<article class="record-card"><b class="record-name">' + esc(row.display_name) + '</b><p class="record-email">' +
            esc(row.scans || 0) + ' scans</p><div class="record-chips">' + pay + '</div><label class="check"><input type="checkbox" data-listing="' +
            esc(row.listing_id) + '"' + (row.is_visible ? " checked" : "") + "> Show on the passport</label></article>";
        }).join("") || '<p class="muted small">No stores yet.</p>';
      }
      var people = document.getElementById("co-list");
      if (people) {
        people.innerHTML = team.map(function (row) {
          return '<article class="record-card"><b class="record-name">' + esc(row.name || row.email) + '</b><p class="record-email">' +
            esc(row.email) + '</p><span class="chip">' + esc(row.role) + "</span></article>";
        }).join("") || '<p class="muted small">No teammates loaded.</p>';
      }
    }

    async function loadShops() {
      var res = await HCCrawl.client().rpc("organizer_crawl_shops", { p_crawl: active });
      shops = res.error ? [] : (res.data || []);
    }

    async function loadTeam() {
      var res = await HCCrawl.client().rpc("organizer_list_co_organizers", { p_crawl_id: active });
      team = res.error ? [] : (res.data || []);
    }

    HCCrawl.getSession().then(async function (session) {
      if (!session || !session.user || session.user.is_anonymous || !session.user.email) return;
      var mine = await HCCrawl.client().rpc("organizer_my_crawls");
      if (mine.error || !mine.data || !mine.data.length) return;
      crawls = mine.data;
      active = crawls[0].crawl_id;
      showTab();
      await loadShops();
      await loadTeam();
      renderLive();
    }).catch(function () {});

    var picker = document.getElementById("org-crawl");
    if (picker) {
      picker.addEventListener("change", async function () {
        if (demoOn()) return;
        active = picker.value;
        await loadShops();
        await loadTeam();
        renderLive();
      });
    }

    var details = document.getElementById("org-details");
    if (details) {
      details.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        var err = document.getElementById("org-err");
        var ok = document.getElementById("org-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        var title = document.getElementById("org-title").value.trim();
        var start = document.getElementById("org-start").value;
        var end = document.getElementById("org-end").value;
        if (!title || !start || !end || end < start) {
          if (err) { err.textContent = "Title and dates need an end date on or after the start."; err.classList.add("show"); }
          return;
        }
        var saved = await HCCrawl.client().rpc("organizer_update_crawl", {
          p_crawl: active,
          p_name: title,
          p_starts: start,
          p_ends: end
        });
        if (saved.error) {
          if (err) { err.textContent = saved.error.message || "Could not save the crawl."; err.classList.add("show"); }
          return;
        }
        var crawl = current();
        if (crawl) { crawl.name = title; crawl.starts_at = start; crawl.ends_at = end; }
        renderLive();
        if (ok) { ok.textContent = "Crawl details saved."; ok.classList.add("show"); }
      });
    }

    var storeList = document.getElementById("org-stores");
    if (storeList) {
      storeList.addEventListener("change", async function (ev) {
        if (demoOn()) return;
        var box = ev.target.closest && ev.target.closest("[data-listing]");
        if (!box) return;
        var saved = await HCCrawl.client().rpc("organizer_set_shop_visible", {
          p_listing: box.getAttribute("data-listing"),
          p_visible: box.checked
        });
        if (saved.error) box.checked = !box.checked;
      });
    }

    var invite = document.getElementById("co-invite-form");
    if (invite) {
      invite.addEventListener("submit", async function (ev) {
        if (demoOn()) return;
        ev.preventDefault();
        var email = document.getElementById("co-email").value.trim().toLowerCase();
        var err = document.getElementById("co-err");
        var ok = document.getElementById("co-ok");
        if (err) { err.textContent = ""; err.classList.remove("show"); }
        if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
        var saved = await HCCrawl.client().rpc("organizer_add_co_organizer", {
          p_crawl_id: active,
          p_email: email,
          p_name: null
        });
        if (saved.error) {
          if (err) { err.textContent = saved.error.message || "Could not add that co-organizer."; err.classList.add("show"); }
          return;
        }
        document.getElementById("co-email").value = "";
        await loadTeam();
        renderLive();
        if (ok) { ok.textContent = "Co-organizer added. No email was sent. They sign in with that address."; ok.classList.add("show"); }
      });
    }
  });
})();
