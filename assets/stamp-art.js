/* Store-tab stamp image and logo.
   Demo (?demo=1) keeps the picture in this browser only.
   A signed-in owner uploads to the shop-images bucket and saves the path
   with shop_set_stamp_art. Guests never write these columns. */
(function () {
  var KEY = "hc-stamp-art";
  var MAX_BYTES = 2 * 1024 * 1024;
  var TYPES = ["image/png", "image/jpeg", "image/webp"];

  function demoOn() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function fixture() {
    return (window.__HC_ENV__ && window.__HC_ENV__.DEMO_STORE) || null;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function extFor(type) {
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    return "jpg";
  }

  function acceptFile(file) {
    if (!file) return "Choose an image.";
    var type = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (TYPES.indexOf(type) === -1) return "Use a PNG, JPG, or WebP image.";
    if (file.size > MAX_BYTES) return "Images need to be 2 MB or smaller.";
    return "";
  }

  function artSrc(stamp, logo) {
    return stamp || logo || "";
  }

  function readAll() {
    try {
      var parsed = JSON.parse(localStorage.getItem(KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function readLocal(businessId) {
    var row = readAll()[businessId];
    if (!row || typeof row !== "object") return { stamp: "", logo: "" };
    return {
      stamp: typeof row.stamp === "string" ? row.stamp : "",
      logo: typeof row.logo === "string" ? row.logo : ""
    };
  }

  function writeLocal(businessId, row) {
    var all = readAll();
    all[businessId] = { stamp: row.stamp || "", logo: row.logo || "" };
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  function cropSquare(file, type) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
        if (!side) {
          URL.revokeObjectURL(url);
          reject(new Error("That image has no pixels."));
          return;
        }
        var canvas = document.createElement("canvas");
        var out = Math.min(side, 512);
        canvas.width = out;
        canvas.height = out;
        var ctx = canvas.getContext("2d");
        var sx = Math.floor(((img.naturalWidth || img.width) - side) / 2);
        var sy = Math.floor(((img.naturalHeight || img.height) - side) / 2);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) reject(new Error("Could not crop that image."));
          else resolve(blob);
        }, type, 0.9);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image."));
      };
      img.src = url;
    });
  }

  function blobUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read that image.")); };
      reader.readAsDataURL(blob);
    });
  }

  function note(okText, errText) {
    var ok = document.getElementById("stamp-art-ok");
    var err = document.getElementById("stamp-art-err");
    if (ok) {
      ok.textContent = okText || "";
      ok.classList.toggle("show", !!okText);
    }
    if (err) {
      err.textContent = errText || "";
      err.classList.toggle("show", !!errText);
    }
  }

  function labelFor(name) {
    return (name || "Shop").split(" ")[0];
  }

  function paint(record, name) {
    var src = artSrc(record.stamp, record.logo);
    var crop = document.getElementById("stamp-crop-img");
    var empty = document.getElementById("stamp-crop-empty");
    if (crop) {
      if (src) {
        crop.src = src;
        crop.classList.remove("hidden");
        if (empty) empty.classList.add("hidden");
      } else {
        crop.removeAttribute("src");
        crop.classList.add("hidden");
        if (empty) empty.classList.remove("hidden");
      }
    }
    var inner = src
      ? '<img class="stamp-art" alt="" src="' + esc(src) + '">'
      : '<span class="stamp-label">' + esc(labelFor(name)) + "</span>";
    ["sample-open", "sample-got"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = inner;
    });
    var got = document.getElementById("sample-got");
    if (got && src) {
      got.classList.remove("just");
      void got.offsetWidth;
      got.classList.add("just");
    }
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var n = Math.random() * 16 | 0;
      return (ch === "x" ? n : (n & 0x3 | 0x8)).toString(16);
    });
  }

  async function ownerListings() {
    if (!window.HCCrawl || !HCCrawl.client) return [];
    var client = HCCrawl.client();
    if (!client) return [];
    var session = await HCCrawl.getSession();
    if (!session || session.user.is_anonymous) return [];
    var res = await client.rpc("shop_my_listings");
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function saveLive(listing, kind, blob, type, previousPath) {
    var client = HCCrawl.client();
    var ext = extFor(type);
    var path = listing.listing_id + "/" + kind + "/" + uuid() + "." + ext;
    var up = await client.storage.from("shop-images").upload(path, blob, {
      contentType: type,
      upsert: false
    });
    if (up.error) throw up.error;
    var saved = await client.rpc("shop_set_stamp_art", {
      p_listing: listing.listing_id,
      p_kind: kind,
      p_path: path
    });
    if (saved.error) {
      await client.storage.from("shop-images").remove([path]);
      throw saved.error;
    }
    if (previousPath && previousPath !== path) {
      await client.storage.from("shop-images").remove([previousPath]);
    }
    return path;
  }

  async function clearLive(listing, kind, previousPath) {
    var client = HCCrawl.client();
    var saved = await client.rpc("shop_set_stamp_art", {
      p_listing: listing.listing_id,
      p_kind: kind,
      p_path: null
    });
    if (saved.error) throw saved.error;
    if (previousPath) await client.storage.from("shop-images").remove([previousPath]);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("stamp-art-form");
    if (!form) return;
    var demo = fixture();
    var businessId = demo && demo.shop ? demo.shop.businessId : "anthem";
    var shopName = demo && demo.shop ? demo.shop.name : "Shop";
    var record = demoOn() ? readLocal(businessId) : { stamp: "", logo: "" };
    var listing = null;

    function showStoreTab() {
      var tabs = document.getElementById("role-tabs");
      var btn = document.getElementById("tab-store");
      if (tabs) tabs.classList.remove("hidden");
      if (btn) btn.classList.remove("hidden");
    }

    function publicUrl(path) {
      if (!path || !window.HCCrawl || !HCCrawl.client) return "";
      var client = HCCrawl.client();
      if (!client) return "";
      var out = client.storage.from("shop-images").getPublicUrl(path);
      return (out && out.data && out.data.publicUrl) || "";
    }

    function applyListing(row) {
      listing = row;
      if (!row || demoOn()) return;
      record = {
        stamp: publicUrl(row.stamp_image_path),
        logo: publicUrl(row.logo_path)
      };
      if (row.display_name) shopName = row.display_name;
      paint(record, shopName);
    }

    paint(record, shopName);

    if (demoOn()) showStoreTab();

    var picker = document.getElementById("stamp-listing");
    var pickerField = document.getElementById("stamp-listing-field");
    if (!demoOn() && window.HCCrawl) {
      ownerListings().then(function (rows) {
        if (!rows.length) return;
        showStoreTab();
        if (rows.length > 1 && picker && pickerField) {
          picker.innerHTML = rows.map(function (row) {
            return '<option value="' + esc(row.listing_id) + '">' + esc(row.display_name || row.crawl_name || "Listing") + "</option>";
          }).join("");
          pickerField.classList.remove("hidden");
          picker.onchange = function () {
            var next = rows.filter(function (row) { return row.listing_id === picker.value; })[0];
            applyListing(next || rows[0]);
          };
        }
        applyListing(rows[0]);
      }).catch(function () {});
    }

    async function onFile(kind, input) {
      var file = input.files && input.files[0];
      input.value = "";
      note("", "");
      var problem = acceptFile(file);
      if (problem) { note("", problem); return; }
      var type = file.type === "image/jpg" ? "image/jpeg" : file.type;
      try {
        var blob = await cropSquare(file, type);
        if (demoOn()) {
          record[kind] = await blobUrl(blob);
          writeLocal(businessId, record);
          paint(record, shopName);
          note("DEMO DATA. Saved in this browser only. It is not stored for other guests.", "");
          document.dispatchEvent(new CustomEvent("hc-stamp-art-changed"));
          return;
        }
        if (!listing) {
          note("", "Sign in as the store owner to save this on the passport.");
          return;
        }
        var previous = kind === "stamp" ? listing.stamp_image_path : listing.logo_path;
        var path = await saveLive(listing, kind, blob, type, previous || "");
        if (kind === "stamp") listing.stamp_image_path = path;
        else listing.logo_path = path;
        record[kind] = publicUrl(path);
        paint(record, shopName);
        note("Saved. Guests see it grey until they stamp, then in color.", "");
        document.dispatchEvent(new CustomEvent("hc-stamp-art-changed"));
      } catch (e) {
        var message = (e && e.message) || "Could not save that image.";
        if (/shop_set_stamp_art|schema cache|column/i.test(message)) {
          message = "Stamp images save after the database update is applied. Nothing was kept.";
        }
        note("", message);
      }
    }

    var stampInput = document.getElementById("file-stamp");
    var logoInput = document.getElementById("file-logo");
    if (stampInput) stampInput.onchange = function () { onFile("stamp", stampInput); };
    if (logoInput) logoInput.onchange = function () { onFile("logo", logoInput); };

    async function clearKind(kind) {
      note("", "");
      try {
        if (demoOn()) {
          record[kind] = "";
          writeLocal(businessId, record);
          paint(record, shopName);
          note("DEMO DATA. Removed in this browser only.", "");
          document.dispatchEvent(new CustomEvent("hc-stamp-art-changed"));
          return;
        }
        if (!listing) {
          note("", "Sign in as the store owner to change this.");
          return;
        }
        var previous = kind === "stamp" ? listing.stamp_image_path : listing.logo_path;
        await clearLive(listing, kind, previous || "");
        if (kind === "stamp") listing.stamp_image_path = null;
        else listing.logo_path = null;
        record[kind] = "";
        paint(record, shopName);
        note("Removed.", "");
        document.dispatchEvent(new CustomEvent("hc-stamp-art-changed"));
      } catch (e) {
        note("", (e && e.message) || "Could not remove that image.");
      }
    }

    var clearStamp = document.getElementById("btn-clear-stamp");
    var clearLogo = document.getElementById("btn-clear-logo");
    if (clearStamp) clearStamp.onclick = function () { clearKind("stamp"); };
    if (clearLogo) clearLogo.onclick = function () { clearKind("logo"); };
  });

  window.HCStampArt = {
    MAX_BYTES: MAX_BYTES,
    acceptFile: acceptFile,
    artSrc: artSrc,
    extFor: extFor
  };
})();
