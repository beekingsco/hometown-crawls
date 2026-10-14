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
    var svg = svgEl("svg", {
      class: "card-lights",
      viewBox: "0 0 800 108",
      preserveAspectRatio: "xMidYMid meet",
      "aria-hidden": "true"
    });
    svg.append(svgEl("path", {
      d: "M6 62 C 80 18, 130 96, 200 54 S 310 8, 400 64 S 520 104, 610 46 S 720 14, 794 58",
      fill: "none",
      stroke: "#2C241C",
      "stroke-width": "5",
      "stroke-linecap": "round"
    }));
    var colors = ["#D7263D", "#1F7A3A", "#E0B03A"];
    for (var i = 0; i < 11; i++) {
      var x = 40 + i * 72;
      var y = i % 2 === 0 ? 72 : 36;
      svg.append(svgEl("rect", { x: x - 8, y: y - 26, width: "16", height: "12", rx: "2", fill: "#3A3128" }));
      svg.append(svgEl("circle", { cx: x, cy: y, r: "18", fill: colors[i % 3] }));
      svg.append(svgEl("circle", { cx: x - 6, cy: y - 6, r: "5", fill: "#ffffff", opacity: "0.35" }));
    }
    return svg;
  }

  function treeScene() {
    var svg = svgEl("svg", { class: "card-deco card-tree", viewBox: "0 0 180 160", "aria-hidden": "true" });
    svg.append(svgEl("polygon", { points: "90,2 100,26 126,26 106,42 114,66 90,52 66,66 74,42 54,26 80,26", fill: "#E0B03A" }));
    svg.append(svgEl("polygon", { points: "90,30 138,74 42,74", fill: "#1F4D36" }));
    svg.append(svgEl("polygon", { points: "90,52 154,104 26,104", fill: "#246B45" }));
    svg.append(svgEl("polygon", { points: "90,78 168,136 12,136", fill: "#1F4D36" }));
    [[62, 64], [112, 58], [74, 90], [124, 96], [48, 116], [96, 120], [142, 112], [68, 128], [118, 78]].forEach(function (dot) {
      svg.append(svgEl("circle", { cx: dot[0], cy: dot[1], r: "3.4", fill: "#F4F7F8" }));
    });
    svg.append(svgEl("rect", { x: "80", y: "132", width: "20", height: "24", fill: "#6B3E2A" }));
    svg.append(svgEl("rect", { x: "6", y: "118", width: "42", height: "36", rx: "2", fill: "#D7263D" }));
    svg.append(svgEl("rect", { x: "23", y: "118", width: "8", height: "36", fill: "#E0B03A" }));
    svg.append(svgEl("rect", { x: "6", y: "132", width: "42", height: "8", fill: "#E0B03A" }));
    svg.append(svgEl("rect", { x: "132", y: "126", width: "42", height: "28", rx: "2", fill: "#1F7A3A" }));
    svg.append(svgEl("rect", { x: "149", y: "126", width: "8", height: "28", fill: "#E0B03A" }));
    svg.append(svgEl("rect", { x: "132", y: "136", width: "42", height: "7", fill: "#E0B03A" }));
    return svg;
  }

  function hollyScene() {
    var svg = svgEl("svg", { class: "card-deco card-holly", viewBox: "0 0 200 160", "aria-hidden": "true" });
    svg.append(svgEl("path", {
      d: "M4 118 C 36 96, 48 108, 70 78 C 86 104, 112 88, 132 58 C 146 82, 168 70, 196 42",
      fill: "none", stroke: "#1F4D36", "stroke-width": "7", "stroke-linecap": "round"
    }));
    svg.append(svgEl("path", {
      d: "M18 132 C 48 112, 64 122, 88 96 C 104 116, 136 104, 168 78",
      fill: "none", stroke: "#246B45", "stroke-width": "6", "stroke-linecap": "round"
    }));
    [[28, 108], [46, 92], [64, 100], [84, 78], [102, 88], [122, 66], [58, 118], [96, 108], [140, 84], [154, 70]].forEach(function (leaf, index) {
      svg.append(svgEl("ellipse", {
        cx: leaf[0], cy: leaf[1], rx: index % 2 ? "11" : "9", ry: "5",
        fill: index % 2 ? "#1F4D36" : "#2A6844",
        transform: "rotate(" + (index * 28 - 40) + " " + leaf[0] + " " + leaf[1] + ")"
      }));
    });
    [[40, 96], [72, 86], [98, 74], [126, 70], [54, 112], [88, 104], [146, 78], [34, 118], [112, 92]].forEach(function (berry) {
      svg.append(svgEl("circle", { cx: berry[0], cy: berry[1], r: "5.5", fill: "#D7263D" }));
    });
    svg.append(svgEl("path", { d: "M150 96 h36 a12 12 0 0 1 0 24 h-36 z", fill: "#F8F4EA", stroke: "#1F4D36", "stroke-width": "2.5" }));
    svg.append(svgEl("path", { d: "M150 96 h12 a16 12 0 0 1 0 24 h-12 z", fill: "#E0B03A" }));
    svg.append(svgEl("path", { d: "M162 84 h12 v16 h-12 z", fill: "#1F4D36" }));
    svg.append(svgEl("path", { d: "M158 84 q10 -16 22 0", fill: "none", stroke: "#6B3E2A", "stroke-width": "2.5" }));
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

  function face(model) {
    var card = el("article", "passport-card");
    var shops = model.shops || [];
    var half = Math.ceil(shops.length / 2);
    card.append(lights());
    card.append(el("h1", "card-crawl", model.crawlName || "Hometown crawl"));
    var edition = subtitle(model.crawlName, model.startsAt, model.endsAt);
    if (edition) card.append(el("p", "card-edition", edition));
    card.append(tagline());
    card.append(stampGrid(shops));
    card.append(el("h2", "card-back-title", "PARTICIPATING COFFEE SHOPS"));
    card.append(el("p", "card-key-title", "USE THIS KEY TO FIND YOUR NEXT STOP"));
    var key = el("div", "shop-key");
    key.append(shopColumn(shops.slice(0, half), 1));
    key.append(el("div", "shop-rule"));
    key.append(shopColumn(shops.slice(half), half + 1));
    card.append(key);
    card.append(playerBlock(model));
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
    root.replaceChildren(sheet(model));
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
    orderedShops: orderedShops,
    scaleFor: scaleFor,
    render: render
  };
})();
