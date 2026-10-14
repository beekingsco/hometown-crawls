/* Listing editor on the Store tab. Demo edits stay in this browser.
   Live saves use shop_listings and the shop-images bucket (owner RLS). */
(function () {
  var KEY = "hc-listing-anthemco";
  var IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

  function fixture() {
    return (window.__HC_ENV__ && window.__HC_ENV__.DEMO_STORE) || null;
  }

  function demoOn() {
    return new URLSearchParams(location.search).get("demo") === "1";
  }

  function esc(value) {
    return window.HCStoreDemo && HCStoreDemo.esc
      ? HCStoreDemo.esc(value)
      : String(value || "");
  }

  function blank() {
    var base = (fixture() && fixture().listing) || {};
    return {
      name: (fixture() && fixture().shop && fixture().shop.name) || "",
      stampLabel: "",
      address: base.address || "",
      phone: base.phone || "",
      hours: base.hours || "",
      description: base.description || "",
      website: base.website || "",
      instagram: base.instagram || "",
      cover: "",
      logo: "",
      stamp: "",
      gallery: []
    };
  }

  function loadLocal() {
    var listing = blank();
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && typeof saved === "object") {
        ["name", "stampLabel", "address", "phone", "hours", "description", "website", "instagram", "cover", "logo", "stamp"].forEach(function (key) {
          if (typeof saved[key] === "string") listing[key] = saved[key];
        });
        if (Array.isArray(saved.gallery)) listing.gallery = saved.gallery.filter(function (item) { return typeof item === "string"; }).slice(0, 8);
      }
    } catch (e) {}
    return listing;
  }

  function saveLocal(listing) {
    localStorage.setItem(KEY, JSON.stringify(listing));
  }

  function fileType(file) {
    if (!file) return "";
    return file.type === "image/jpg" ? "image/jpeg" : file.type;
  }

  function limitFor(inputId) {
    return inputId === "file-list-stamp" || inputId === "file-list-logo" ? 2 : 5;
  }

  function readFile(file, limitMb) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("Choose an image."));
      if (IMAGE_TYPES.indexOf(fileType(file)) === -1) return reject(new Error("Use a PNG, JPG, or WebP image."));
      var limit = limitMb || 5;
      if (file.size > limit * 1024 * 1024) return reject(new Error("Images need to be " + limit + " MB or smaller."));
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read that image.")); };
      reader.readAsDataURL(file);
    });
  }

  function setPreview(id, src, emptyId) {
    var img = document.getElementById(id);
    var empty = emptyId ? document.getElementById(emptyId) : null;
    if (!img) return;
    if (src) {
      img.src = src;
      img.classList.remove("hidden");
      if (empty) empty.classList.add("hidden");
    } else {
      img.removeAttribute("src");
      img.classList.add("hidden");
      if (empty) empty.classList.remove("hidden");
    }
  }

  function paint(listing) {
    var map = {
      "list-name": listing.name,
      "list-stamp-label": listing.stampLabel,
      "list-address": listing.address,
      "list-phone": listing.phone,
      "list-hours": listing.hours,
      "list-description": listing.description,
      "list-website": listing.website,
      "list-instagram": listing.instagram
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && document.activeElement !== el) el.value = map[id] || "";
    });
    setPreview("preview-cover", listing.cover, "empty-cover");
    setPreview("preview-logo", listing.logo, "empty-logo");
    setPreview("preview-stamp", listing.stamp, "empty-stamp");
    var gallery = document.getElementById("list-gallery");
    if (!gallery) return;
    gallery.innerHTML = (listing.gallery || []).map(function (src, index) {
      return '<figure class="gallery-item"><img src="' + esc(src) + '" alt=""><button type="button" data-remove-photo="' + index + '">Remove</button></figure>';
    }).join("") || '<p class="muted small" id="gallery-empty">No gallery photos yet.</p>';
  }

  function readForm(listing) {
    listing.name = document.getElementById("list-name").value.trim();
    listing.stampLabel = document.getElementById("list-stamp-label").value.trim();
    listing.address = document.getElementById("list-address").value.trim();
    listing.phone = document.getElementById("list-phone").value.trim();
    listing.hours = document.getElementById("list-hours").value.trim();
    listing.description = document.getElementById("list-description").value.trim();
    listing.website = document.getElementById("list-website").value.trim();
    listing.instagram = document.getElementById("list-instagram").value.trim().replace(/^@/, "");
    return listing;
  }

  function validate(listing) {
    if (!listing.name || listing.name.length > 200) return "Shop name needs to be 1–200 characters.";
    if (listing.stampLabel.length > 40) return "Stamp label needs to be 40 characters or fewer.";
    if (listing.address.length > 300) return "Address needs to be 300 characters or fewer.";
    if (listing.hours.length > 500) return "Hours need to be 500 characters or fewer.";
    if (listing.description.length > 600) return "Description needs to be 600 characters or fewer.";
    if (listing.website && !/^https?:\/\//i.test(listing.website)) return "Website must start with http:// or https://.";
    if (listing.website.length > 300) return "Website needs to be 300 characters or fewer.";
    if (listing.instagram.length > 100) return "Instagram needs to be 100 characters or fewer.";
    if (listing.phone.length > 40) return "Phone needs to be 40 characters or fewer.";
    if ((listing.gallery || []).length > 8) return "You can keep up to 8 photos.";
    return "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("listing-form");
    if (!form || !demoOn()) return;
    var listing = loadLocal();
    paint(listing);

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var err = document.getElementById("list-err");
      var ok = document.getElementById("list-ok");
      if (err) { err.textContent = ""; err.classList.remove("show"); }
      if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
      readForm(listing);
      var problem = validate(listing);
      if (problem) {
        if (err) { err.textContent = problem; err.classList.add("show"); }
        return;
      }
      saveLocal(listing);
      try {
        var art = JSON.parse(localStorage.getItem("hc-stamp-art") || "{}");
        art.anthem = { stamp: listing.stamp || "", logo: listing.logo || "" };
        localStorage.setItem("hc-stamp-art", JSON.stringify(art));
        var labels = JSON.parse(localStorage.getItem("hc-stamp-labels") || "{}");
        labels.anthem = listing.stampLabel || "";
        localStorage.setItem("hc-stamp-labels", JSON.stringify(labels));
      } catch (e) {}
      document.dispatchEvent(new CustomEvent("hc-stamp-art-changed"));
      if (ok) { ok.textContent = "DEMO DATA. Listing saved in this browser only."; ok.classList.add("show"); }
      if (window.HC) HC.toast("Listing saved");
    };

    function bindFile(inputId, key) {
      var input = document.getElementById(inputId);
      if (!input) return;
      input.onchange = async function () {
        var file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        try {
          listing[key] = await readFile(file, limitFor(inputId));
          saveLocal(listing);
          paint(listing);
        } catch (e) {
          var err = document.getElementById("list-err");
          if (err) { err.textContent = e.message || "Could not add that image."; err.classList.add("show"); }
        }
      };
    }
    bindFile("file-cover", "cover");
    bindFile("file-list-logo", "logo");
    bindFile("file-list-stamp", "stamp");

    var galleryInput = document.getElementById("file-gallery");
    if (galleryInput) {
      galleryInput.onchange = async function () {
        var file = galleryInput.files && galleryInput.files[0];
        galleryInput.value = "";
        if (!file) return;
        if ((listing.gallery || []).length >= 8) return;
        try {
          listing.gallery = (listing.gallery || []).concat([await readFile(file, 5)]).slice(0, 8);
          saveLocal(listing);
          paint(listing);
        } catch (e) {
          var err = document.getElementById("list-err");
          if (err) { err.textContent = e.message || "Could not add that photo."; err.classList.add("show"); }
        }
      };
    }
    var gallery = document.getElementById("list-gallery");
    if (gallery) {
      gallery.onclick = function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-remove-photo]");
        if (!btn) return;
        var index = Number(btn.getAttribute("data-remove-photo"));
        listing.gallery = (listing.gallery || []).filter(function (_, i) { return i !== index; });
        saveLocal(listing);
        paint(listing);
      };
    }
  });

  function extFor(type) {
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    return "jpg";
  }

  function publicUrl(path) {
    if (!path || !window.HCCrawl || !HCCrawl.client) return "";
    var client = HCCrawl.client();
    if (!client) return "";
    var out = client.storage.from("shop-images").getPublicUrl(path);
    return (out && out.data && out.data.publicUrl) || "";
  }

  function showErr(text) {
    var err = document.getElementById("list-err");
    if (err) { err.textContent = text || ""; err.classList.toggle("show", !!text); }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("listing-form");
    if (!form || demoOn() || !window.HCCrawl) return;
    var listing = null;
    var paths = [];

    function paintLive() {
      if (!listing) return;
      var map = {
        "list-name": listing.display_name || "",
        "list-stamp-label": listing.stamp_label || "",
        "list-address": listing.address || "",
        "list-phone": listing.phone || "",
        "list-hours": listing.hours || "",
        "list-description": listing.blurb || "",
        "list-website": listing.website || "",
        "list-instagram": listing.instagram || ""
      };
      Object.keys(map).forEach(function (id) {
        var el = document.getElementById(id);
        if (el && document.activeElement !== el) el.value = map[id];
      });
      setPreview("preview-cover", paths[0] ? publicUrl(paths[0]) : "", "empty-cover");
      setPreview("preview-logo", listing.logo_path ? publicUrl(listing.logo_path) : "", "empty-logo");
      setPreview("preview-stamp", listing.stamp_image_path ? publicUrl(listing.stamp_image_path) : "", "empty-stamp");
      var gallery = document.getElementById("list-gallery");
      if (!gallery) return;
      var rest = paths.slice(1);
      gallery.innerHTML = rest.map(function (src, index) {
        return '<figure class="gallery-item"><img src="' + esc(publicUrl(src)) + '" alt=""><button type="button" data-remove-live="' + (index + 1) + '">Remove</button></figure>';
      }).join("") || '<p class="muted small">No gallery photos yet.</p>';
    }

    async function upload(folder, file, limitMb) {
      var type = fileType(file);
      if (IMAGE_TYPES.indexOf(type) === -1) throw new Error("Use a PNG, JPG, or WebP image.");
      if (file.size > limitMb * 1024 * 1024) throw new Error("Images need to be " + limitMb + " MB or smaller.");
      var client = HCCrawl.client();
      var path = listing.listing_id + "/" + folder + "/" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + "." + extFor(type);
      var up = await client.storage.from("shop-images").upload(path, file, { contentType: type, upsert: false });
      if (up.error) throw up.error;
      return path;
    }

    HCCrawl.getSession().then(async function (session) {
      if (!session || !session.user || session.user.is_anonymous) return;
      var rows = await HCCrawl.client().rpc("shop_my_listings");
      if (rows.error || !rows.data || !rows.data.length) return;
      listing = rows.data[0];
      paths = Array.isArray(listing.photo_paths) ? listing.photo_paths.slice() : [];
      var tabs = document.getElementById("role-tabs");
      var btn = document.getElementById("tab-store");
      if (tabs) tabs.classList.remove("hidden");
      if (btn) btn.classList.remove("hidden");
      var name = document.getElementById("store-name");
      var code = document.getElementById("store-code");
      var big = document.getElementById("store-code-big");
      if (name) name.textContent = listing.display_name || "Your shop";
      if (code && listing.store_code) code.textContent = listing.store_code;
      if (big && listing.store_code) big.textContent = listing.store_code;
      paintLive();
    }).catch(function () {});

    form.addEventListener("submit", async function (ev) {
      if (demoOn()) return;
      ev.preventDefault();
      showErr("");
      var ok = document.getElementById("list-ok");
      if (ok) { ok.textContent = ""; ok.classList.remove("show"); }
      if (!listing) { showErr("Sign in as the store owner to save this listing."); return; }
      var draft = {
        name: document.getElementById("list-name").value.trim(),
        stampLabel: document.getElementById("list-stamp-label").value.trim(),
        address: document.getElementById("list-address").value.trim(),
        phone: document.getElementById("list-phone").value.trim(),
        hours: document.getElementById("list-hours").value.trim(),
        description: document.getElementById("list-description").value.trim(),
        website: document.getElementById("list-website").value.trim(),
        instagram: document.getElementById("list-instagram").value.trim().replace(/^@/, "")
      };
      var problem = validate(draft);
      if (problem) { showErr(problem); return; }
      var saved = await HCCrawl.client().rpc("shop_save_listing", {
        p_listing: listing.listing_id,
        p_name: draft.name,
        p_address: draft.address,
        p_phone: draft.phone,
        p_hours: draft.hours,
        p_blurb: draft.description,
        p_website: draft.website,
        p_instagram: draft.instagram,
        p_stamp_label: draft.stampLabel
      });
      if (saved.error) {
        var message = saved.error.message || "Could not save the listing.";
        if (/shop_save_listing|schema cache/i.test(message)) message = "Listing saves after the database update is applied.";
        showErr(message);
        return;
      }
      listing.display_name = draft.name;
      listing.stamp_label = draft.stampLabel;
      if (ok) { ok.textContent = "Listing saved."; ok.classList.add("show"); }
      if (window.HC) HC.toast("Listing saved");
    });

    async function onLiveFile(inputId, folder, limitMb, apply) {
      var input = document.getElementById(inputId);
      if (!input) return;
      input.addEventListener("change", async function () {
        if (demoOn()) return;
        var file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        if (!listing) { showErr("Sign in as the store owner to add images."); return; }
        showErr("");
        var path = "";
        try {
          path = await upload(folder, file, limitMb);
          await apply(path);
          paintLive();
        } catch (e) {
          if (path) {
            try { await HCCrawl.client().storage.from("shop-images").remove([path]); } catch (ignore) {}
          }
          var message = (e && e.message) || "Could not add that image.";
          if (/schema cache|shop_set_/i.test(message)) message = "Images save after the database update is applied.";
          showErr(message);
        }
      });
    }

    onLiveFile("file-cover", "gallery", 5, async function (path) {
      var next = [path].concat(paths.filter(function (item) { return item !== path; })).slice(0, 8);
      var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: listing.listing_id, p_paths: next });
      if (saved.error) throw saved.error;
      paths = next;
    });
    onLiveFile("file-gallery", "gallery", 5, async function (path) {
      if (paths.length >= 8) throw new Error("You can keep up to 8 photos.");
      var next = paths.concat([path]);
      var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: listing.listing_id, p_paths: next });
      if (saved.error) throw saved.error;
      paths = next;
    });
    onLiveFile("file-list-stamp", "stamp", 2, async function (path) {
      var saved = await HCCrawl.client().rpc("shop_set_stamp_art", { p_listing: listing.listing_id, p_kind: "stamp", p_path: path });
      if (saved.error) throw saved.error;
      listing.stamp_image_path = path;
    });
    onLiveFile("file-list-logo", "logo", 2, async function (path) {
      var saved = await HCCrawl.client().rpc("shop_set_stamp_art", { p_listing: listing.listing_id, p_kind: "logo", p_path: path });
      if (saved.error) throw saved.error;
      listing.logo_path = path;
    });

    var gallery = document.getElementById("list-gallery");
    if (gallery) {
      gallery.addEventListener("click", async function (ev) {
        if (demoOn()) return;
        var btn = ev.target.closest && ev.target.closest("[data-remove-live]");
        if (!btn || !listing) return;
        var index = Number(btn.getAttribute("data-remove-live"));
        var removed = paths[index];
        var next = paths.filter(function (_, i) { return i !== index; });
        var saved = await HCCrawl.client().rpc("shop_set_photo_paths", { p_listing: listing.listing_id, p_paths: next });
        if (saved.error) { showErr(saved.error.message || "Could not remove that photo."); return; }
        paths = next;
        if (removed) {
          try { await HCCrawl.client().storage.from("shop-images").remove([removed]); } catch (e) {}
        }
        paintLive();
      });
    }
  });

  window.HCListing = { loadLocal: loadLocal, KEY: KEY, limitFor: limitFor };
})();
