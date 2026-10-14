/* Holiday paper card. One walking-mascot image. Ink circles only. */
(function () {
  var NS = "http://www.w3.org/2000/svg";
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

  function svgEl(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function lights() {
    var svg = svgEl("svg", { class: "card-lights", viewBox: "0 0 340 42", "aria-hidden": "true" });
    svg.append(svgEl("path", {
      d: "M6 24 C 28 8, 46 36, 72 20 S 112 6, 146 22 S 186 38, 220 18 S 268 8, 334 22",
      fill: "none",
      stroke: "#2C241C",
      "stroke-width": "2.2",
      "stroke-linecap": "round"
    }));
    ["#D7263D", "#1F7A3A", "#E0B03A", "#D7263D", "#1F7A3A", "#E0B03A", "#D7263D", "#1F7A3A", "#E0B03A", "#D7263D"].forEach(function (color, index) {
      var y = index % 2 === 0 ? 28 : 14;
      svg.append(svgEl("circle", { cx: 16 + index * 33, cy: y, r: "6.5", fill: color }));
      svg.append(svgEl("rect", { x: 13 + index * 33, y: y - 11, width: "6", height: "5", rx: "1", fill: "#3A3128" }));
    });
    return svg;
  }

  function treeScene() {
    var svg = svgEl("svg", { class: "card-deco", viewBox: "0 0 120 96", "aria-hidden": "true" });
    svg.append(svgEl("polygon", { points: "58,6 66,18 50,18", fill: "#E0B03A" }));
    svg.append(svgEl("polygon", { points: "58,16 86,48 30,48", fill: "#1F4D36" }));
    svg.append(svgEl("polygon", { points: "58,30 94,66 22,66", fill: "#2A6844" }));
    svg.append(svgEl("polygon", { points: "58,46 102,84 14,84", fill: "#1F4D36" }));
    [[40, 40], [70, 36], [48, 58], [78, 62], [36, 72], [64, 74]].forEach(function (dot) {
      svg.append(svgEl("circle", { cx: dot[0], cy: dot[1], r: "2.2", fill: "#F4F7F8" }));
    });
    svg.append(svgEl("rect", { x: "52", y: "80", width: "12", height: "12", fill: "#6B3E2A" }));
    svg.append(svgEl("rect", { x: "8", y: "70", width: "22", height: "16", rx: "1", fill: "#D7263D" }));
    svg.append(svgEl("rect", { x: "16", y: "70", width: "6", height: "16", fill: "#E0B03A" }));
    svg.append(svgEl("rect", { x: "92", y: "74", width: "20", height: "14", rx: "1", fill: "#1F7A3A" }));
    svg.append(svgEl("rect", { x: "99", y: "74", width: "5", height: "14", fill: "#E0B03A" }));
    return svg;
  }

  function hollyScene() {
    var svg = svgEl("svg", { class: "card-deco", viewBox: "0 0 130 96", "aria-hidden": "true" });
    svg.append(svgEl("path", {
      d: "M8 70 C 24 40, 40 48, 52 28 C 60 46, 78 36, 90 18",
      fill: "none",
      stroke: "#1F4D36",
      "stroke-width": "3",
      "stroke-linecap": "round"
    }));
    svg.append(svgEl("path", {
      d: "M20 74 C 36 58, 48 64, 62 50 C 74 62, 96 54, 118 34",
      fill: "none",
      stroke: "#2A6844",
      "stroke-width": "3",
      "stroke-linecap": "round"
    }));
    [[34, 52], [48, 44], [70, 40], [28, 66], [58, 60], [86, 48]].forEach(function (berry) {
      svg.append(svgEl("circle", { cx: berry[0], cy: berry[1], r: "3.3", fill: "#D7263D" }));
    });
    svg.append(svgEl("path", { d: "M96 58 h22 a8 8 0 0 1 0 16 h-22 z", fill: "#F8F4EA", stroke: "#1F4D36", "stroke-width": "2" }));
    svg.append(svgEl("path", { d: "M96 58 h8 a10 8 0 0 1 0 16 h-8 z", fill: "#E0B03A" }));
    svg.append(svgEl("path", { d: "M104 50 h8 v10 h-8 z", fill: "#1F4D36" }));
    svg.append(svgEl("path", { d: "M100 50 q8 -12 16 0", fill: "none", stroke: "#6B3E2A", "stroke-width": "2" }));
    return svg;
  }

  function motto(line) {
    var p = el("p", "card-motto");
    var bits = line.split(" / ");
    p.append(document.createTextNode(bits[0] + " "));
    p.append(el("span", "heart", "♥"));
    p.append(document.createTextNode(" " + (bits[1] || "")));
    return p;
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
    var parts = {};
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles"
    }).formatToParts(new Date(value)).forEach(function (part) {
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
    if (/holiday/i.test(String(name || ""))) return "HOLIDAY EDITION";
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

  function face(kind, model) {
    var card = el("article", "passport-card passport-" + kind);
    card.append(lights());
    if (kind === "front") {
      card.append(el("h1", "card-crawl", model.crawlName || "Hometown crawl"));
      var edition = subtitle(model.crawlName, model.startsAt, model.endsAt);
      if (edition) card.append(el("p", "card-edition", edition));
      card.append(tagline());
      card.append(stampGrid(model.shops || []));
      var foot = el("div", "card-foot");
      foot.append(treeScene());
      var center = el("div", "card-center");
      var mascot = document.createElement("img");
      mascot.className = "card-mascot";
      mascot.src = "/assets/home/mascot.png";
      mascot.alt = "";
      center.append(mascot);
      center.append(motto("GOOD COFFEE / BRIGHTER DAYS"));
      foot.append(center);
      foot.append(hollyScene());
      card.append(foot);
      return card;
    }
    card.append(el("h2", "card-back-title", "PARTICIPATING COFFEE SHOPS"));
    card.append(el("p", "card-key-title", "USE THIS KEY TO FIND YOUR NEXT STOP"));
    var shops = model.shops || [];
    var half = Math.ceil(shops.length / 2);
    var key = el("div", "shop-key");
    key.append(shopColumn(shops.slice(0, half), 1));
    key.append(el("div", "shop-rule"));
    key.append(shopColumn(shops.slice(half), half + 1));
    card.append(key);
    card.append(playerBlock(model));
    var backFoot = el("div", "card-back-foot");
    backFoot.append(hollyScene());
    backFoot.append(motto("LOCAL COFFEE / STRONGER TOGETHER"));
    backFoot.append(treeScene());
    card.append(backFoot);
    return card;
  }

  function sheet(kind, model) {
    var page = el("section", "card-sheet card-sheet-" + kind);
    page.append(face(kind, model));
    page.append(face(kind, model));
    return page;
  }

  function render(root, model) {
    root.replaceChildren(sheet("front", model), sheet("back", model));
  }

  async function load() {
    var root = document.getElementById("card-sheets");
    var status = document.getElementById("card-status");
    if (!root) return;
    var crawl = params().get("crawl") || "puy-coffee";
    var blank = params().get("blank") === "1";
    var user = params().get("user") || "";
    var model = {
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

  function printCard(single) {
    document.body.classList.toggle("print-single", !!single);
    window.print();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var two = document.getElementById("card-print");
    var one = document.getElementById("card-print-single");
    if (two) two.addEventListener("click", function () { printCard(false); });
    if (one) one.addEventListener("click", function () { printCard(true); });
    load();
  });

  window.HCCard = {
    TURN_IN: TURN_IN,
    subtitle: subtitle,
    orderedShops: orderedShops,
    render: render
  };
})();
