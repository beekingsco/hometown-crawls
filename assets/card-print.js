/* Printable crawl card. Ink circles only: no initials and no digital stamp list. */
(function () {
  var TURN_IN = "Bring your finished card to a co-organizer shop (e.g. Holiday Cafe, Anthem).";
  var RULES = [
    "Get one ink stamp in each circle. The shop stamps the card.",
    "Use the name and email on this card. That is the account for the drawing.",
    "One card per person.",
    "Show some love if you can and buy something at the shop.",
    "NO PURCHASE NECESSARY. Each stamped stop is one prize entry. A finished card adds 3 bonus entries."
  ];

  function params() {
    return new URLSearchParams(location.search);
  }

  function text(tag, className, value) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value || "";
    return el;
  }

  function face(kind, model) {
    var card = document.createElement("article");
    card.className = "passport-card passport-" + kind;
    if (kind === "front") {
      card.append(text("h1", "card-crawl", model.crawlName || "Hometown crawl"));
      var brand = document.createElement("div");
      brand.className = "card-brand";
      var mascot = document.createElement("img");
      mascot.src = "/assets/home/mascot.png";
      mascot.alt = "";
      var logo = document.createElement("img");
      logo.src = "/assets/home/wordmark-phone.png";
      logo.alt = "Hometown Crawls";
      brand.append(mascot, logo);
      card.append(brand);
      card.append(text("p", "card-signup", model.signupShop ? "Signed up at " + model.signupShop : "Signed up at"));
      var grid = document.createElement("div");
      grid.className = "stamp-grid";
      (model.shops || []).forEach(function (shop) {
        var spot = document.createElement("div");
        spot.className = "stamp-spot-wrap";
        var circle = document.createElement("div");
        circle.className = "stamp-spot";
        circle.setAttribute("aria-hidden", "true");
        spot.append(circle, text("p", "stamp-name", shop));
        grid.append(spot);
      });
      card.append(grid);
      return card;
    }
    card.append(text("h2", null, "Player"));
    var nameLine = document.createElement("p");
    nameLine.className = "card-line";
    nameLine.append(text("span", null, "Name"));
    nameLine.append(text("b", null, model.playerName || ""));
    var emailLine = document.createElement("p");
    emailLine.className = "card-line";
    emailLine.append(text("span", null, "Email"));
    emailLine.append(text("b", null, model.playerEmail || ""));
    card.append(nameLine, emailLine);
    var rules = document.createElement("ul");
    rules.className = "card-rules";
    RULES.forEach(function (rule) { rules.append(text("li", null, rule)); });
    card.append(rules);
    card.append(text("p", "card-prize", "Prize note: one entry for each ink stamp, plus 3 entries for a finished card."));
    card.append(text("p", "card-turnin", TURN_IN));
    if (model.turnIn && model.turnIn.length) card.append(text("p", "card-turnin-list", model.turnIn.join(", ")));
    return card;
  }

  function sheet(kind, model) {
    var page = document.createElement("section");
    page.className = "card-sheet";
    page.append(face(kind, model), face(kind, model));
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
    var named = await client.from("crawls").select("name").eq("id", crawl).maybeSingle();
    if (!named.error && named.data && named.data.name) model.crawlName = named.data.name;
    var shops = await client.rpc("get_public_crawl_shops", { p_crawl: crawl });
    if (!shops.error && Array.isArray(shops.data)) {
      var seen = {};
      model.shops = shops.data.filter(function (row) {
        var name = row && row.display_name;
        if (!name || seen[name]) return false;
        seen[name] = true;
        return true;
      }).map(function (row) { return row.display_name; });
    }
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

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("card-print");
    if (button) button.addEventListener("click", function () { window.print(); });
    load();
  });

  window.HCCard = { TURN_IN: TURN_IN, RULES: RULES, render: render };
})();
