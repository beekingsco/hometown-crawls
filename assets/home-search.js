/* Homepage crawl search and the newest-crawl cards. */
(function () {
  const NEAR_MILES = 50;
  const EARTH_MILES = 3958.8;
  const PUBLIC_COLUMNS = "id, name, city, type, lat, lng, blurb, starts_at, ends_at, created_at";
  const EMPTY_LEAD = "No crawls near you yet — ";
  const EMPTY_LINK = "start one";
  const EMPTY_HREF = "/organize";
  const KNOWN_PAGES = {
    "puy-coffee": "/puyallup/holiday-coffee-crawl",
    "puy-pub": "/puyallupwa/pub"
  };

  function miles(lat1, lng1, lat2, lng2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function crawlPhase(crawl, now) {
    const t = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
    const start = crawl && crawl.starts_at ? new Date(crawl.starts_at).getTime() : null;
    const end = crawl && crawl.ends_at ? new Date(crawl.ends_at).getTime() : null;
    const started = start == null || start <= t;
    if (end != null && end < t && started) return "ended";
    if (start == null || start > t) return "upcoming";
    return "active";
  }

  function byCreatedThenName(a, b) {
    const ac = new Date(a.created_at || 0).getTime();
    const bc = new Date(b.created_at || 0).getTime();
    if (bc !== ac) return bc - ac;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }

  function newestCrawls(rows, now) {
    return (rows || [])
      .filter((row) => crawlPhase(row, now) !== "ended")
      .slice()
      .sort(byCreatedThenName)
      .slice(0, 3);
  }

  function nearbyCrawls(rows, origin, now, radiusMiles) {
    const limit = Number.isFinite(radiusMiles) ? radiusMiles : NEAR_MILES;
    const lat = Number(origin && origin.lat);
    const lng = Number(origin && origin.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return (rows || [])
      .map((row) => {
        const rowLat = Number(row.lat);
        const rowLng = Number(row.lng);
        if (!Number.isFinite(rowLat) || !Number.isFinite(rowLng)) return null;
        return Object.assign({}, row, { distance: miles(lat, lng, rowLat, rowLng) });
      })
      .filter((row) => row && row.distance <= limit + 0.05 && crawlPhase(row, now) !== "ended")
      .sort((a, b) => a.distance - b.distance || String(a.name || "").localeCompare(String(b.name || "")));
  }

  function crawlHref(id) {
    return KNOWN_PAGES[id] || "/account.html";
  }

  function typeArt(type) {
    const key = String(type || "").toLowerCase();
    if (key === "coffee") return "/assets/home/coffee.jpg";
    if (key === "pub") return "/assets/home/pub.jpg";
    if (key === "food" || key === "restaurant") return "/assets/home/food.jpg";
    if (key === "gift" || key === "gift shop") return "/assets/home/gift-shop.png";
    return "/assets/home/street-scene-phone.png";
  }

  function dateParts(value) {
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles"
    }).formatToParts(new Date(value)).forEach((part) => {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    return parts;
  }

  function formatDates(crawl) {
    const start = crawl && crawl.starts_at ? dateParts(crawl.starts_at) : null;
    const end = crawl && crawl.ends_at ? dateParts(crawl.ends_at) : null;
    if (!start && !end) return "Dates coming soon";
    if (start && !end) return start.month + " " + start.day + ", " + start.year;
    if (!start && end) return "Through " + end.month + " " + end.day + ", " + end.year;
    if (start.year === end.year && start.month === end.month) {
      return start.month + " " + start.day + " – " + end.day + ", " + start.year;
    }
    if (start.year === end.year) {
      return start.month + " " + start.day + " – " + end.month + " " + end.day + ", " + start.year;
    }
    return start.month + " " + start.day + ", " + start.year + " – " + end.month + " " + end.day + ", " + end.year;
  }

  function formatMiles(distance) {
    if (distance < 0.1) return "Nearby";
    if (distance < 10) return distance.toFixed(1) + " miles";
    return Math.round(distance) + " miles";
  }

  function rpcMissing(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const message = String(error.message || error.details || "");
    return code === "PGRST202" || code === "42883" || /does not exist|could not find the function|list_public_crawls/i.test(message);
  }

  async function geocode(query, fetchImpl) {
    const q = String(query || "").trim();
    const fetcher = fetchImpl || fetch;
    const zip = q.match(/^(\d{5})(?:-\d{4})?$/);
    if (zip) {
      const response = await fetcher("https://api.zippopotam.us/us/" + zip[1]);
      if (!response.ok) {
        const error = new Error("place");
        error.kind = "place";
        throw error;
      }
      const data = await response.json();
      const place = data && data.places && data.places[0];
      const lat = place ? Number(place.latitude) : NaN;
      const lng = place ? Number(place.longitude) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const error = new Error("place");
        error.kind = "place";
        throw error;
      }
      return {
        lat,
        lng,
        label: [place["place name"], place["state abbreviation"]].filter(Boolean).join(", ")
      };
    }
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q="
      + encodeURIComponent(q);
    const response = await fetcher(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const error = new Error("place");
      error.kind = "place";
      throw error;
    }
    const data = await response.json();
    const hit = Array.isArray(data) ? data[0] : null;
    const lat = hit ? Number(hit.lat) : NaN;
    const lng = hit ? Number(hit.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const error = new Error("place");
      error.kind = "place";
      throw error;
    }
    return { lat, lng, label: hit.display_name || q };
  }

  function renderEmpty(container) {
    const p = document.createElement("p");
    p.className = "home-empty";
    const link = document.createElement("a");
    link.setAttribute("href", EMPTY_HREF);
    link.textContent = EMPTY_LINK;
    p.append(EMPTY_LEAD, link);
    container.replaceChildren(p);
  }

  function card(crawl, withPhoto) {
    const article = document.createElement("article");
    article.className = "home-crawl-card";
    if (withPhoto) {
      const photo = document.createElement("div");
      photo.className = "home-card-photo";
      const img = document.createElement("img");
      img.src = typeArt(crawl.type);
      img.alt = "";
      img.width = 700;
      img.height = 420;
      photo.append(img);
      const phase = crawlPhase(crawl);
      if (phase === "active" || phase === "upcoming") {
        const tag = document.createElement("span");
        tag.className = "home-tag";
        tag.textContent = phase === "active" ? "Active" : "Upcoming";
        photo.append(tag);
      }
      article.append(photo);
    }
    const body = document.createElement("div");
    body.className = "home-card-body";
    const title = document.createElement("h3");
    const href = crawlHref(crawl.id);
    const nameLink = document.createElement("a");
    nameLink.setAttribute("href", href);
    nameLink.textContent = crawl.name || "Crawl";
    title.append(nameLink);
    const town = document.createElement("p");
    town.className = "home-crawl-meta";
    const bits = [];
    if (crawl.city) bits.push(String(crawl.city));
    if (Number.isFinite(crawl.distance)) bits.push(formatMiles(crawl.distance));
    town.textContent = bits.join(" · ");
    const dates = document.createElement("p");
    dates.className = "home-event-dates";
    dates.textContent = formatDates(crawl);
    const more = document.createElement("a");
    more.className = "home-text-link";
    more.setAttribute("href", href);
    more.textContent = "View crawl";
    body.append(title, town, dates, more);
    article.append(body);
    return article;
  }

  function paintCards(container, rows, withPhoto) {
    container.replaceChildren();
    rows.forEach((row) => container.append(card(row, withPhoto)));
  }

  let catalogPromise = null;

  async function loadPublicCrawls(sb) {
    const rpc = await sb.rpc("list_public_crawls");
    if (!rpc.error) return rpc.data || [];
    if (!rpcMissing(rpc.error)) throw rpc.error;
    const fallback = await sb.from("crawls").select(PUBLIC_COLUMNS);
    if (fallback.error) throw fallback.error;
    return fallback.data || [];
  }

  function catalog() {
    const sb = window.HCCrawl && window.HCCrawl.client && window.HCCrawl.client();
    if (!sb) return Promise.reject(new Error("unavailable"));
    if (!catalogPromise) {
      catalogPromise = loadPublicCrawls(sb).catch((error) => {
        catalogPromise = null;
        throw error;
      });
    }
    return catalogPromise;
  }

  function init() {
    const form = document.getElementById("crawl-search");
    const input = document.getElementById("crawl-place");
    const searchStatus = document.getElementById("crawl-search-status");
    const results = document.getElementById("crawl-results");
    const newest = document.getElementById("new-crawls-list");
    const newestStatus = document.getElementById("new-crawls-status");
    if (!form || !input || !results || !newest) return;

    catalog().then((rows) => {
      const fresh = newestCrawls(rows);
      paintCards(newest, fresh, true);
      if (newestStatus) newestStatus.textContent = fresh.length ? "" : "No new crawls to show yet.";
    }).catch(() => {
      if (newestStatus) newestStatus.textContent = "Crawl information is temporarily unavailable.";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      const button = form.querySelector("button");
      if (button) button.disabled = true;
      results.replaceChildren();
      if (searchStatus) searchStatus.textContent = "Looking up crawls…";
      try {
        const place = await geocode(query);
        const rows = await catalog();
        const matches = nearbyCrawls(rows, place);
        if (!matches.length) {
          if (searchStatus) searchStatus.textContent = "";
          renderEmpty(results);
          return;
        }
        paintCards(results, matches, false);
        const count = matches.length === 1 ? "1 crawl" : matches.length + " crawls";
        if (searchStatus) searchStatus.textContent = count + " within 50 miles.";
      } catch (error) {
        results.replaceChildren();
        if (searchStatus) {
          searchStatus.textContent = error && error.kind === "place"
            ? "We couldn't find that place. Try a zip code or City, ST."
            : "We couldn't look up crawls just now. Please try again.";
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  window.HCHome = {
    NEAR_MILES,
    EMPTY_LEAD,
    EMPTY_LINK,
    EMPTY_HREF,
    miles,
    crawlPhase,
    newestCrawls,
    nearbyCrawls,
    crawlHref,
    formatDates,
    geocode,
    typeArt,
    rpcMissing,
    renderEmpty
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
