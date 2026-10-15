/* Live printable card model with a Puyallup-only holiday skin. */
(function () {
  var TURN_IN = "Bring your finished card to a co-organizer shop (e.g. Holiday Cafe, Anthem).";
  var TAGLINE = ["SIP", "SHOP", "EXPLORE", "SUPPORT LOCAL"];

  function params() {
    return new URLSearchParams(location.search);
  }

  function el(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }

  function tagline() {
    var p = el("p", "card-tagline");
    TAGLINE.forEach(function (word, index) {
      p.append(document.createTextNode(word));
      if (index < TAGLINE.length - 1) p.append(el("span", "star", " ★ "));
    });
    return p;
  }

  function dateParts(value) {
    // Calendar dates have no timezone. Preserve their day instead of parsing as UTC.
    var dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    var date = new Date(dateOnly ? value + "T12:00:00Z" : value);
    var parts = {};
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: dateOnly ? "UTC" : "America/Los_Angeles"
    }).formatToParts(date).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    return parts;
  }

  function formatDates(starts, ends) {
    if (!starts && !ends) return "";
    function label(value) {
      var part = dateParts(value);
      return (part.month + " " + part.day + ", " + part.year).toUpperCase();
    }
    if (starts && ends) {
      var start = dateParts(starts);
      var end = dateParts(ends);
      if (start.year === end.year) {
        return (start.month + " " + start.day + " – " + end.month + " " + end.day + ", " + start.year).toUpperCase();
      }
      return label(starts) + " – " + label(ends);
    }
    return label(starts || ends);
  }

  function subtitle(name, starts, ends) {
    return formatDates(starts, ends);
  }

  function orderedShops(rows) {
    var seen = {};
    return (rows || []).map(function (row) { return row && row.display_name; }).filter(function (name) {
      if (!name || seen[name]) return false;
      seen[name] = true;
      return true;
    }).sort(function (a, b) { return a.localeCompare(b, "en", { sensitivity: "base" }); });
  }

  function stampGrid(shops) {
    var grid = el("div", "stamp-grid");
    shops.forEach(function (shop, index) {
      var wrap = el("div", "stamp-spot-wrap");
      wrap.append(el("div", "stamp-spot", String(index + 1)));
      wrap.title = shop;
      grid.append(wrap);
    });
    return grid;
  }

  function shopColumn(shops, start) {
    var list = document.createElement("ol");
    shops.forEach(function (shop, index) {
      var item = document.createElement("li");
      item.append(el("span", "shop-num", String(start + index)));
      item.append(el("span", "shop-name", shop));
      list.append(item);
    });
    return list;
  }

  function playerBlock(model) {
    var block = el("div", "card-player");
    block.append(line("Name", model.playerName || ""));
    block.append(line("Email", model.playerEmail || ""));
    block.append(line("Signed up at", model.signupShop || ""));
    block.append(el("p", "card-turnin", TURN_IN));
    if (model.turnIn && model.turnIn.length) block.append(el("p", "card-turnin-list", model.turnIn.join(", ")));
    return block;
  }

  function line(label, value) {
    var row = el("p", "card-line");
    row.append(el("span", null, label));
    row.append(el("b", null, value));
    return row;
  }

  function face(model) {
    var card = el("article", "passport-card");
    var shops = model.shops || [];
    var half = Math.ceil(shops.length / 2);
    card.append(el("h1", "card-crawl", model.crawlName || "Hometown crawl"));
    var edition = subtitle(model.crawlName, model.startsAt, model.endsAt);
    if (edition) card.append(el("p", "card-edition", edition));
    card.append(tagline());
    card.append(stampGrid(shops));
    card.append(el("h2", "card-back-title", "PARTICIPATING SHOPS"));
    card.append(el("p", "card-key-title", "USE THIS KEY TO FIND YOUR NEXT STOP"));
    var key = el("div", "shop-key");
    key.append(shopColumn(shops.slice(0, half), 1));
    key.append(el("div", "shop-rule"));
    key.append(shopColumn(shops.slice(half), half + 1));
    card.append(key);
    card.append(playerBlock(model));
    var rules = el("ul", "card-rules");
    ["Get one ink stamp in each circle. The shop stamps the card.",
     "Use the name and email on this card. That is the account for the drawing.",
     "One card per person.", "Show some love if you can and buy something at the shop.",
     "NO PURCHASE NECESSARY. Each stamped stop is one prize entry. A finished card adds 3 bonus entries."
    ].forEach(function (rule) { rules.append(el("li", null, rule)); });
    card.append(rules);
    var foot = el("div", "card-foot");

    var center = el("div", "card-center");
    var mascot = document.createElement("img");
    mascot.className = "card-mascot";
    mascot.src = "/assets/home/mascot.png";
    mascot.alt = "";
    center.append(mascot);

    foot.append(center);

    card.append(foot);
    return card;
  }

  function scaleFor(count) {
    var shops = Math.max(0, count || 0);
    var rows = Math.max(1, Math.ceil((shops || 1) / 5));
    var lines = Math.max(1, Math.ceil((shops || 1) / 2));
    var tight = rows > 4 || lines > 12;
    var very = rows > 10;
    var stampIn = tight ? Math.min(0.62, Math.max(very ? 0.16 : 0.22, 2.05 / rows)) : Math.min(1.1, 3.55 / rows);
    var lineIn = tight ? Math.min(0.14, Math.max(0.075, 1.55 / lines)) : Math.min(0.2, 2.5 / lines);
    return {
      stamp: stampIn.toFixed(3) + "in",
      list: (lineIn * 72 / 1.2).toFixed(2) + "pt",
      deco: very ? "0.7in" : tight ? "0.9in" : "1.65in",
      mascot: very ? "0.62in" : tight ? "0.8in" : "1.3in",
      rowGap: (tight ? 0.04 : 0.16).toFixed(2) + "in",
      lights: tight ? "0.38in" : "auto",
      title: tight ? "16pt" : "26pt",
      edition: tight ? "11pt" : "16pt",
      tight: tight
    };
  }

  function sheet(model) {
    var page = el("section", "card-sheet");
    page.append(face(model));
    var scale = scaleFor((model.shops || []).length);
    page.style.setProperty("--stamp", scale.stamp);
    page.style.setProperty("--list", scale.list);
    page.style.setProperty("--deco", scale.deco);
    page.style.setProperty("--mascot", scale.mascot);
    page.style.setProperty("--row-gap", scale.rowGap);
    page.style.setProperty("--lights", scale.lights);
    page.style.setProperty("--title", scale.title);
    page.style.setProperty("--edition", scale.edition);
    if (scale.tight) page.dataset.tight = "1";
    return page;
  }

  function render(root, model) {
    var holiday = model.crawlId === "puy-coffee" && window.HCHolidayCard;
    document.body.classList.toggle("holiday-print", !!holiday);
    document.documentElement.classList.toggle("holiday-print", !!holiday);
    root.classList.toggle("holiday-preview-scroll", !!holiday);
    var instructions = document.getElementById("card-print-instructions");
    if (instructions) instructions.textContent = holiday
      ? "Print at actual size on one portrait US Letter page. Stamp spaces, shop key, player details and rules are together. More than 30 shops use clearly numbered continuation pages."
      : "Download & print puts the whole card on one portrait letter page. Shops mark the numbered circles in ink.";
    if (holiday) HCHolidayCard.render(root, model);
    else root.replaceChildren(sheet(model));
  }

  async function load() {
    var root = document.getElementById("card-sheets");
    var status = document.getElementById("card-status");
    if (!root) return;
    var crawl = params().get("crawl") || "puy-coffee";
    var blank = params().get("blank") === "1";
    var pdfLink = document.getElementById("card-pdf-download");
    var pdfNote = document.getElementById("card-pdf-note");
    if (pdfLink) pdfLink.hidden = crawl !== "puy-coffee";
    if (pdfNote) pdfNote.hidden = crawl !== "puy-coffee";
    var user = params().get("user") || "";
    var model = {
      crawlId: crawl,
      crawlName: "Hometown crawl",
      startsAt: "",
      endsAt: "",
      signupShop: "",
      playerName: "",
      playerEmail: "",
      shops: [],
      turnIn: []
    };
    var client = window.HCCrawl && HCCrawl.client && HCCrawl.client();
    if (!client) {
      if (status) status.textContent = "Card details are temporarily unavailable.";
      render(root, model);
      return;
    }
    var named = await client.from("crawls").select("name, starts_at, ends_at").eq("id", crawl).maybeSingle();
    if (!named.error && named.data) {
      if (named.data.name) model.crawlName = named.data.name;
      model.startsAt = named.data.starts_at || "";
      model.endsAt = named.data.ends_at || "";
    }
    var shops = await client.rpc("get_public_crawl_shops", { p_crawl: crawl });
    if (!shops.error && Array.isArray(shops.data)) model.shops = orderedShops(shops.data);
    var info = null;
    if (!blank && user) info = await client.rpc("organizer_player_card", { p_crawl: crawl, p_user: user });
    else if (!blank) info = await client.rpc("my_paper_card", { p_crawl: crawl });
    var row = info && !info.error && info.data && info.data[0];
    if (row) {
      model.crawlName = row.crawl_name || model.crawlName;
      if (!blank) {
        model.playerName = row.player_name || "";
        model.playerEmail = row.player_email || "";
        model.signupShop = row.signup_shop || "";
      }
    }
    var turns = await client.rpc("card_turn_in_shops", { p_crawl: crawl });
    if (!turns.error && Array.isArray(turns.data)) {
      model.turnIn = turns.data.map(function (item) { return item.display_name; }).filter(Boolean);
    }
    if (status) status.textContent = model.shops.length ? "" : "Shops will appear here as they join.";
    render(root, model);
  }

  function printCard() {
    window.print();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("card-print");
    if (button) button.addEventListener("click", printCard);
    load();
  });

  window.HCCard = {
    TURN_IN: TURN_IN,
    subtitle: subtitle,
    formatDates: formatDates,
    orderedShops: orderedShops,
    scaleFor: scaleFor,
    render: render
  };
})();

