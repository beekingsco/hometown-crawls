/* Paste-a-link players. Official iframes only. Unknown hosts return nothing. */
(function (root) {
  "use strict";

  var YT_ID = /^[A-Za-z0-9_-]{11}$/;
  var IG_CODE = /^[A-Za-z0-9_-]{5,30}$/;
  var IG_USER = /^[A-Za-z0-9._]{1,30}$/;
  var TT_USER = /^[A-Za-z0-9._]{1,30}$/;
  var TT_ID = /^[0-9]{6,30}$/;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bareHost(hostname) {
    var host = String(hostname || "").toLowerCase();
    if (host.slice(0, 4) === "www.") return host.slice(4);
    if (host.slice(0, 2) === "m.") return host.slice(2);
    return host;
  }

  function youtube(id) {
    if (!YT_ID.test(id)) return null;
    return {
      provider: "youtube",
      src: "https://www.youtube-nocookie.com/embed/" + id,
      layout: "wide",
      title: "YouTube video"
    };
  }

  function parseYoutube(url, host) {
    if (host === "youtube-nocookie.com") {
      var embedParts = url.pathname.split("/").filter(Boolean);
      if (embedParts[0] === "embed") return youtube(embedParts[1] || "");
      return null;
    }
    var fromQuery = url.searchParams.get("v") || "";
    if (fromQuery && url.pathname.replace(/\/+$/, "") === "/watch") return youtube(fromQuery);
    var parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v")) {
      return youtube(parts[1]);
    }
    return null;
  }

  function parseInstagram(url) {
    var parts = url.pathname.split("/").filter(Boolean);
    var kind = "";
    var code = "";
    if (parts.length >= 2 && /^(reel|reels|p|tv)$/.test(parts[0]) && IG_CODE.test(parts[1] || "")) {
      kind = parts[0];
      code = parts[1];
    } else if (parts.length >= 3 && IG_USER.test(parts[0] || "") && /^(reel|reels|p|tv)$/.test(parts[1]) && IG_CODE.test(parts[2] || "")) {
      kind = parts[1];
      code = parts[2];
    } else {
      return null;
    }
    var embedKind = kind === "reels" ? "reel" : kind;
    return {
      provider: "instagram",
      src: "https://www.instagram.com/" + embedKind + "/" + code + "/embed",
      layout: embedKind === "p" ? "post" : "portrait",
      title: "Instagram video"
    };
  }

  function parseTikTok(url) {
    var parts = url.pathname.split("/").filter(Boolean);
    var id = "";
    if (parts.length >= 3 && parts[0].charAt(0) === "@" && TT_USER.test(parts[0].slice(1)) && parts[1] === "video" && TT_ID.test(parts[2] || "")) {
      id = parts[2];
    } else if (parts.length >= 3 && parts[0] === "embed" && parts[1] === "v2" && TT_ID.test(parts[2] || "")) {
      id = parts[2];
    } else {
      return null;
    }
    return {
      provider: "tiktok",
      src: "https://www.tiktok.com/embed/v2/" + id,
      layout: "portrait",
      title: "TikTok video"
    };
  }

  function parse(input) {
    var raw = String(input || "").trim();
    if (!raw || raw.length > 500 || raw.slice(0, 8) !== "https://" || /[<>"']/.test(raw)) return null;
    var url;
    try {
      url = new URL(raw);
    } catch (e) {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    var host = bareHost(url.hostname);
    if (host === "youtube.com" || host === "youtube-nocookie.com") return parseYoutube(url, host);
    if (host === "youtu.be") return youtube((url.pathname.split("/").filter(Boolean)[0]) || "");
    if (host === "instagram.com") return parseInstagram(url);
    if (host === "tiktok.com") return parseTikTok(url);
    return null;
  }

  function problem(input) {
    var url = String(input || "").trim();
    if (!url) return "";
    if (url.length > 500) return "Video link needs to be 500 characters or fewer.";
    if (!parse(url)) return "Paste a YouTube, Instagram, or TikTok video URL.";
    return "";
  }

  function frame(input) {
    var embed = parse(input);
    if (!embed) return "";
    var layout = embed.layout === "portrait" ? " is-portrait" : embed.layout === "post" ? " is-post" : "";
    return '<div class="hc-video-frame' + layout + '">' +
      '<iframe src="' + escapeHtml(embed.src) + '" title="' + escapeHtml(embed.title) + '" loading="lazy" ' +
      'referrerpolicy="strict-origin-when-cross-origin" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>' +
      "</div>";
  }

  function mount(el, input) {
    if (!el) return false;
    var markup = frame(input);
    el.innerHTML = markup;
    el.hidden = !markup;
    el.classList.toggle("hidden", !markup);
    return !!markup;
  }

  var api = { parse: parse, problem: problem, frame: frame, mount: mount };
  root.HCVideo = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
