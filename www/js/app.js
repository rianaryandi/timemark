(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const cv = $("cv");
  const ctx = cv.getContext("2d");

  let img = null;          // current source image (HTMLImageElement)
  let gps = null;          // {lat, lon, accuracy}
  let isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  // ---------- LIVE CAMERA STATE ----------
  let camStream = null;
  let camFacing = "environment";
  let camActive = false;
  let camTimer = null;
  let camSaving = false;

  let logoImg = null;
  let logoReady = false;
  const FILTERS = {
    none: "none",
    warm: "sepia(.35) saturate(1.35) contrast(1.05) brightness(1.02)",
    vivid: "saturate(1.55) contrast(1.12)",
    bw: "grayscale(1) contrast(1.08)",
    sepia: "sepia(.85) saturate(1.1)",
    cool: "hue-rotate(190deg) saturate(1.15) brightness(1.02)",
    night: "brightness(.9) contrast(1.18) saturate(1.2) brightness(.85) sepia(.12)",
  };

  const screens = ["mode-pick", "editor", "done", "cam", "recplay", "about"];
  function show(name) {
    screens.forEach((s) => $(s).classList.toggle("active", s === name));
  }

  $("btnAbout").addEventListener("click", () => show("about"));
  $("btnAboutBack").addEventListener("click", () => show("mode-pick"));

  // ============ IMAGE LOADING ============
  function loadFileOnCanvas(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const im = new Image();
      im.onload = () => {
        img = im;
        draw();
        show("editor");
      };
      im.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  $("fileInput").addEventListener("change", (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Use Capacitor Camera/Photos if available (native), else multiple from picker
    if (isCapacitor) {
      pickFromNative();
      return;
    }
    loadFileOnCanvas(files[0]);
  });

  // ============ MODE BUTTONS ============
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (mode === "live") {
        startCamera();
        return;
      }
      if (isCapacitor) {
        pickFromNative(mode);
        return;
      }
      const fi = $("fileInput");
      if (mode === "camera") {
        fi.setAttribute("capture", "environment");
        fi.removeAttribute("multiple");
      } else {
        fi.removeAttribute("capture");
        fi.setAttribute("multiple", "true");
      }
      fi.click();
    });
  });

  // ============ NATIVE (CAPACITOR) PICKING ============
  async function pickFromNative(mode) {
    const plugin = window.Capacitor.Plugins.Camera;
    if (!plugin) {
      alert("Plugin Camera tidak tersedia. Pastikan @capacitor/camera terpasang.");
      return;
    }
    const source = mode === "camera" ? "CAMERA" : "PHOTOS";
    $("gps-status").textContent =
      mode === "camera" ? "Menyiapkan kamera..." : "Menyiapkan galeri...";
    let photo;
    try {
      photo = await withTimeout(
        plugin.getPhoto({
          quality: 92,
          allowEditing: false,
          resultType: "URI",
          source,
          correctOrientation: true,
        }),
        50000
      );
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/cancel/i.test(msg) || /batal/i.test(msg)) return;
      alert("Gagal mengambil foto: " + msg);
      return;
    }
    if (!photo) return;
    $("gps-status").textContent = "Memproses foto...";
    const src =
      photo.webPath ||
      photo.dataUrl ||
      (photo.base64String ? "data:image/jpeg;base64," + photo.base64String : "");
    if (!src) {
      alert("Foto tidak terbaca dari galeri. Coba foto lain.");
      return;
    }
    const im = new Image();
    im.onload = () => {
      img = im;
      draw();
      show("editor");
      $("gps-box").classList.remove("hidden");
      watchGps();
    };
    im.onerror = () => alert("Gagal memuat foto yang dipilih.");
    im.src = src;
  }

  function withTimeout(promise, ms) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), ms);
      promise.then(
        (v) => { clearTimeout(t); res(v); },
        (e) => { clearTimeout(t); rej(e); }
      );
    });
  }

  // ============ BATCH STAMP (banyak foto dari galeri) ============
  $("btnBatch").addEventListener("click", () => {
    $("inpBatch").value = "";
    $("inpBatch").click();
  });

  $("inpBatch").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const st = $("batch-status");
    if (!files.length) return;
    st.classList.remove("hidden");
    const total = files.length;
    let done = 0, ok = 0;
    st.textContent = "Menyiapkan 0/" + total + "...";
    for (let i = 0; i < total; i++) {
      try {
        const im = await fileToImage(files[i]);
        const w = im.naturalWidth, h = im.naturalHeight;
        if (!w || !h) throw new Error("dimensi kosong");
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const tctx = c.getContext("2d");
        tctx.drawImage(im, 0, 0, w, h);
        paintStamp(tctx, w, h, buildOptions(new Date()));
        const blob = await canvasToBlobP(c);
        if (!blob) throw new Error("gagal encode");
        const name = batchFileName(i + 1);
        let res;
        if (isCapacitor) {
          res = await nativeSave(blob, name);
        } else {
          webDownload(blob, name);
          res = { ok: true };
        }
        if (res.ok) ok++;
      } catch (err) { /* lewati file bermasalah */ }
      done++;
      st.textContent = "Memproses " + done + "/" + total + "...";
    }
    st.textContent = "✅ Selesai: " + ok + " dari " + total + " foto di-stempel & disimpan.";
    setTimeout(() => { st.classList.add("hidden"); }, 6000);
  });

  function fileToImage(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("gagal muat gambar"));
        im.src = fr.result;
      };
      fr.onerror = () => rej(new Error("gagal baca file"));
      fr.readAsDataURL(file);
    });
  }

  function canvasToBlobP(c) {
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.94));
  }

  function batchFileName(idx) {
    const now = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const ts = now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
      "_" + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds());
    return "timemark_" + ts + "_" + idx + ".jpg";
  }

  function plugin(name) {
    return window.Capacitor.Plugins[name];
  }

  // ============ GPS ============
  function watchGps() {
    if (!navigator.geolocation) {
      $("gps-status").textContent = "GPS tidak didukung perangkat.";
      return;
    }
    navigator.geolocation.watchPosition(
      (pos) => {
        gps = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          acc: pos.coords.accuracy,
        };
        $("gps-status").textContent =
          "📍 " + gps.lat.toFixed(6) + ", " + gps.lon.toFixed(6) +
          " (±" + Math.round(gps.acc) + " m)";
        draw();
        updateCamOverlay();
        scheduleGeo();
      },
      (err) => {
        $("gps-status").textContent = "Lokasi belum tersedia. Aktifkan GPS & izinkan lokasi.";
        updateCamOverlay();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }

  // ============ ALAMAT OTOMATIS (reverse geocode) ============
  let geoAddr = "";
  let geoBusy = false;
  let lastGeoKey = null;
  let geoTimer = null;

  function scheduleGeo() {
    if (!gps) return;
    const key = gps.lat.toFixed(4) + "," + gps.lon.toFixed(4);
    if (key === lastGeoKey) return;
    if (geoTimer) clearTimeout(geoTimer);
    geoTimer = setTimeout(reverseGeo, 500);
  }

  async function reverseGeo() {
    geoTimer = null;
    if (geoBusy || !gps) return;
    geoBusy = true;
    const lat = gps.lat.toFixed(6);
    const lon = gps.lon.toFixed(6);
    try {
      const resp = await fetch(
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=id&lat=" +
          lat + "&lon=" + lon
      );
      if (!resp.ok) return;
      const j = await resp.json();
      if (!j || j.error) return;
      lastGeoKey = gps.lat.toFixed(4) + "," + gps.lon.toFixed(4);
      const d = j.address || {};
      const street = [
        d.road || d.footway || d.pedestrian || d.neighbourhood || "",
        d.house_number || "",
      ].filter(Boolean).join(" ").trim();
      const cand = [
        street,
        d.neighbourhood || "",
        d.suburb || "",
        d.city_district || "",
        d.city || d.town || d.village || d.municipality || "",
        d.county || "",
        d.state || "",
        d.postcode || "",
        d.country || "",
      ].filter(Boolean);
      const parts = [];
      cand.forEach((p) => {
        if (!parts.length || parts[parts.length - 1] !== p) parts.push(p);
      });
      geoAddr = parts.length ? parts.join(", ") : "";
    } catch (e) {
      /* offline / server error: alamat lama tetap dipakai */
    } finally {
      geoBusy = false;
    }
    if (camActive) updateCamOverlay();
    else draw();
  }

  // ============ MAP REAL-TIME (OpenStreetMap tiles) ============
  const TILE = 256;
  const tileCache = new Map();

  function tileImg(url) {
    let im = tileCache.get(url);
    if (!im) {
      im = new Image();
      im.onload = () => { if (camActive) setTimeout(refreshMap, 60); };
      im.onerror = () => { im.failed = true; if (camActive) setTimeout(refreshMap, 60); };
      im.src = url;
      tileCache.set(url, im);
    }
    return im;
  }

  let mapLastRender = 0;
  function refreshMap() {
    const now = Date.now();
    if (now - mapLastRender < 650) return;
    mapLastRender = now;
    const cv = $("cammap");
    if (!cv) return;
    const mctx = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    mctx.fillStyle = "#1c2129";
    mctx.fillRect(0, 0, W, H);
    if (!gps) {
      mctx.fillStyle = "#9db2c8";
      mctx.font = "12px system-ui";
      mctx.fillText("menunggu GPS...", 12, H / 2);
      return;
    }
    const acc = gps.acc || 0;
    const zoom = acc > 3000 ? 13 : acc > 800 ? 14 : acc > 200 ? 15 : 16;
    const n = Math.pow(2, zoom);
    const latRad = (gps.lat * Math.PI) / 180;
    const xt = Math.floor(((gps.lon + 180) / 360) * n);
    const yf = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
    const yt = Math.floor(yf * n);
    const ox = W / 2 - (((gps.lon + 180) / 360) * n - xt) * TILE;
    const oy = H / 2 - (yf * n - yt) * TILE;
    for (let tx = Math.floor(-ox / TILE) - 1; tx <= Math.ceil((W - ox) / TILE); tx++) {
      const gx = (xt + tx + n) % n;
      for (let ty = Math.floor(-oy / TILE) - 1; ty <= Math.ceil((H - oy) / TILE); ty++) {
        const gy = yt + ty;
        if (gy < 0 || gy >= n) continue;
        const sx = tx * TILE + ox;
        const sy = ty * TILE + oy;
        const im = tileImg("https://tile.openstreetmap.org/" + zoom + "/" + gx + "/" + gy + ".png");
        if (im.complete && im.naturalWidth) mctx.drawImage(im, sx, sy, TILE, TILE);
        else if (im.failed) {
          mctx.fillStyle = "#232833";
          mctx.fillRect(sx, sy, TILE, TILE);
        } else {
          mctx.fillStyle = "#171c24";
          mctx.fillRect(sx, sy, TILE, TILE);
        }
      }
    }
    mctx.fillStyle = "#9db2c8";
    mctx.font = "9px system-ui";
    mctx.fillText("OSM z" + zoom, 5, H - 6);
    const mpp = (156543.03392 * Math.cos(latRad)) / n;
    const rPx = acc > 0 ? Math.max(6, Math.min(160, acc / mpp)) : 0;
    if (rPx > 0) {
      mctx.beginPath();
      mctx.arc(W / 2, H / 2, rPx, 0, Math.PI * 2);
      mctx.fillStyle = "rgba(70,180,255,.15)";
      mctx.fill();
      mctx.strokeStyle = "rgba(70,180,255,.8)";
      mctx.lineWidth = 1.5;
      mctx.stroke();
    }
    mctx.beginPath();
    mctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2);
    mctx.fillStyle = "#ff3b30";
    mctx.fill();
    mctx.strokeStyle = "#fff";
    mctx.lineWidth = 2;
    mctx.stroke();
  }

  // ============ STAMP OPTIONS / LINES ============
  function buildOptions(now) {
    return {
      timeStr: now.toLocaleTimeString("id-ID", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }),
      dateStr: now.toLocaleDateString("id-ID", {
        day: "2-digit", month: "2-digit", year: "numeric",
      }),
      gpsStr: gps ? gps.lat.toFixed(6) + ", " + gps.lon.toFixed(6) : null,
      address: $("txtAddress").value.trim() || geoAddr || "",
      company: $("inpCompany").value.trim(),
      name: $("inpName").value.trim(),
      showCert: $("chkCert").checked,
      cert: "SIG:1·EPOCH:" + Math.floor(now.getTime() / 1000) + (gps ? "·COORD:" + gps.lat.toFixed(6) + "," + gps.lon.toFixed(6) + "±" + Math.round(gps.acc) + "m" : "") + "·UTC:" + now.toISOString(),
      filter: (FILTERS[$("selFilter").value] || "none"),
      showLogo: $("chkLogo").checked,
      showTime: $("chkTime").checked,
      showDate: $("chkDate").checked,
      showGps: $("chkGps").checked,
      pos: $("selPos").value,
      color: $("txtColor").value,
      size: parseInt($("selSize").value, 10) || 48,
      style: $("selStyle").value || "classic",
    };
  }

  // ============ REDRAW WITH STAMP ============
  function wrapText(text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = "";
    for (const w of words) {
      const test = current ? current + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function wrapTextC(dctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = "";
    for (const w of words) {
      const test = current ? current + " " + w : w;
      if (dctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawLogo(dctx, x, y, px) {
    if (logoReady && logoImg) {
      const h = Math.round(px);
      const w = Math.max(1, Math.round(h * (logoImg.width / logoImg.height)));
      dctx.drawImage(logoImg, x, y - h, w, h);
      return w + 8;
    }
    return 0;
  }

  function paintStamp(dctx, W, H, opts) {
    const fs = Math.max(16, Math.min(42, (opts.size / 48) * Math.max(16, H * 0.018)));
    const jamFont = Math.max(26, Math.min(170, Math.round(H * 0.052)));
    if (opts.style === "gedo") {
      paintStampGedo(dctx, W, H, opts, fs);
      return;
    }
    if (opts.style === "timemark") {
      paintStampTimemark(dctx, W, H, opts, fs);
      return;
    }
    const style = opts.style || "classic";
    const noBar = style === "plain";
    const compact = style === "compact";
    // ---- build stamp rows ----
    const rows = [];
    if (opts.showTime) rows.push({ t: opts.timeStr, kind: "big" });
    if (opts.showDate) rows.push({ t: opts.dateStr, kind: "norm" });
    if (opts.showGps && opts.gpsStr) rows.push({ t: "📍 " + opts.gpsStr, kind: "small" });
    if (opts.address) {
      dctx.font = "600 " + Math.round(fs) + "px system-ui, sans-serif";
      const wrapped = wrapText(opts.address, W - 90);
      wrapped.forEach((l) => rows.push({ t: l, kind: "norm" }));
    }
    if (opts.company) rows.push({ t: "Perusahaan: " + opts.company, kind: "norm" });
    if (opts.name) rows.push({ t: "Nama: " + opts.name, kind: "norm" });
    if (opts.showCert) {
      dctx.font = "600 " + Math.round(fs * 0.82) + "px system-ui, sans-serif";
      wrapTextC(dctx, opts.cert, W - 90).forEach((l) => rows.push({ t: l, kind: "small" }));
    }

const rowH = (r) => r.kind === "big"
      ? Math.round(jamFont * 1.35)
      : (r.kind === "small" ? Math.round(fs * 1.3) : Math.round(fs * 1.4));

    // ---- footer/header sized to content ----
    const logoWidth = opts.showLogo ? Math.round(fs * 1.5) + 14 : 0;
    const barH = rows.reduce((a, r) => a + rowH(r), 0) + 24;
    const barY = opts.pos === "top" ? 0 : H - barH;
    const baseY = opts.pos === "top" ? barH : H - barH;

    // properti font tiap baris
    const props = rows.map((r) => {
      if (r.kind === "big")
        return { f: "800 " + Math.round(jamFont) + "px system-ui, sans-serif", c: opts.color };
      if (r.kind === "small")
        return { f: "600 " + Math.round(fs * 0.68) + "px 'Roboto Mono','PT Mono',Consolas,monospace,sans-serif", c: "rgba(190,203,217,0.85)" };
      return { f: "700 " + Math.round(fs) + "px system-ui, sans-serif", c: opts.color };
    });

    // lebar teks terlebar (untuk blok kanan)
    let maxW = 0;
    if (compact) {
      for (let i = 0; i < rows.length; i++) {
        dctx.font = props[i].f;
        maxW = Math.max(maxW, dctx.measureText(rows[i].t).width);
      }
    }

    // ---- latar belakang stempel ----
    if (!noBar) {
      dctx.fillStyle = "rgba(0,0,0,0.55)";
      if (compact) {
        const blkW = maxW + 40;
        const blkX = W - 20 - blkW;
        roundRect(dctx, blkX, barY + 12, blkW, barH - 24, 12);
        dctx.fill();
      } else {
        dctx.fillRect(0, barY, W, barH);
      }
    }

    // ---- logo badge ----
    let x = compact ? W - 20 - maxW - 40 + 20 : 18;
    if (opts.showLogo) {
      const ly = opts.pos === "top" ? Math.round(fs * 1.0) + 10 : baseY + Math.round(fs * 1.0) + 6;
      x += drawLogo(dctx, x, ly, Math.round(fs * 1.2));
    }

    // ---- text rows (jam paling besar, GPS & cert kecil) ----
    dctx.textBaseline = "alphabetic";
    let y = opts.pos === "top"
      ? Math.round(fs * 1.0) + 14
      : baseY + Math.round(fs * 1.0) + 14;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      dctx.font = props[i].f;
      dctx.fillStyle = props[i].c;
      dctx.fillText(r.t, x, y);
      y += rowH(r);
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function paintStampGedo(dctx, W, H, opts, fs) {
    const pad = Math.max(12, Math.round(fs * 0.5));
    const gap = 4;
    const rows = [];
    const timeSize = Math.round(fs * 2.0);
    if (opts.showTime) rows.push({ t: opts.timeStr, f: "800 " + timeSize + "px system-ui, sans-serif", c: "#ffffff" });
    if (opts.showDate) rows.push({ t: opts.dateStr, f: "700 " + Math.round(fs * 0.9) + "px system-ui, sans-serif", c: "#f3f6fd" });
    if (opts.showGps && opts.gpsStr) rows.push({ t: "📍 " + opts.gpsStr, f: "500 " + Math.round(fs * 0.5) + "px 'Roboto Mono','PT Mono',Consolas,monospace,sans-serif", c: "#9fb0c4" });
    if (opts.address) {
      wrapText(opts.address, W - pad * 2 - 12).forEach((l) =>
        rows.push({ t: l, f: "600 " + Math.round(fs * 0.72) + "px system-ui, sans-serif", c: "#ffffff" })
      );
    }
    if (opts.company) rows.push({ t: "🏢 " + opts.company, f: "600 " + Math.round(fs * 0.6) + "px system-ui, sans-serif", c: "#ffd27a" });
    if (opts.name) rows.push({ t: "👤 " + opts.name, f: "600 " + Math.round(fs * 0.6) + "px system-ui, sans-serif", c: "#ffd27a" });
    if (opts.showCert) {
      dctx.font = "500 " + Math.round(fs * 0.5) + "px 'Roboto Mono','PT Mono',Consolas,monospace,sans-serif";
      wrapTextC(dctx, opts.cert, Math.max(140, W - 24 - pad * 2)).forEach((l) =>
        rows.push({ t: l, f: "500 " + Math.round(fs * 0.5) + "px 'Roboto Mono','PT Mono',Consolas,monospace,sans-serif", c: "#9fb0c4" })
      );
    }
    if (!rows.length) rows.push({ t: opts.timeStr || opts.dateStr || "•", f: "800 " + timeSize + "px system-ui, sans-serif", c: "#ffffff" });

    const widths = rows.map((r) => {
      dctx.font = r.f;
      return dctx.measureText(r.t).width;
    });
    const lpx = Math.min(timeSize, Math.round(fs * 1.8));
    const aimgW = logoReady && logoImg ? Math.round(lpx * (logoImg.width / logoImg.height)) : Math.round(lpx * 1.5);
    const logoW = opts.showLogo ? aimgW + 8 : 0;
    const blockW = Math.max.apply(null, widths) + pad * 2 + logoW;
    const hPx = rows.map((r) => parseInt(r.f, 10));
    const blockH = hPx.reduce((a, b) => a + b, 0) + gap * (rows.length - 1) + pad * 2;
    const bx = 10;
    const by = opts.pos === "top" ? 10 : H - blockH - 10;

    dctx.fillStyle = "rgba(0,0,0,0.56)";
    roundRect(dctx, bx, by, blockW, blockH, 10);
    dctx.fill();

    let y = by + pad + hPx[0];
    let x = bx + pad;
    if (opts.showLogo) {
      x += drawLogo(dctx, x, by + pad + lpx, lpx);
    }
    rows.forEach((r, i) => {
      dctx.font = r.f;
      dctx.fillStyle = r.c;
      dctx.textBaseline = "alphabetic";
      dctx.shadowColor = "rgba(0,0,0,0.85)";
      dctx.shadowBlur = 4;
      dctx.shadowOffsetY = 1;
      dctx.fillText(r.t, x, y);
      dctx.shadowBlur = 0;
      dctx.shadowOffsetY = 0;
      if (i < rows.length - 1) y += hPx[i + 1] + gap;
    });
  }

  function paintStampTimemark(dctx, W, H, opts, fs) {
    const pl = 14, pr = 14, pt = 10, pb = 8, rowGap = 2;
    const timeF = Math.round(fs * 2.9);
    const dateF = Math.round(fs * 0.95);
    const infoF = Math.round(fs * 0.78);
    const coordF = Math.round(fs * 0.7);

    const rows = [];
    if (opts.showTime) rows.push({ t: opts.timeStr, f: "800 " + timeF + "px system-ui, sans-serif", c: "#ffffff" });
    if (opts.showDate) rows.push({ t: opts.dateStr, f: "700 " + dateF + "px system-ui, sans-serif", c: "#f2f5fb" });
    if (opts.address) {
      dctx.font = "600 " + infoF + "px system-ui, sans-serif";
      wrapTextC(dctx, opts.address, W - pl - pr - 60).forEach((l) =>
        rows.push({ t: l, f: "600 " + infoF + "px system-ui, sans-serif", c: "#ffffff" })
      );
    }
    if (opts.showGps && opts.gpsStr) rows.push({ t: "📍 " + opts.gpsStr, f: "500 " + Math.round(fs * 0.55) + "px 'Roboto Mono','PT Mono',Consolas,monospace,sans-serif", c: "#9fb0c4" });
    if (opts.company) rows.push({ t: "Perusahaan: " + opts.company, f: "600 " + coordF + "px system-ui, sans-serif", c: "#ffd27a" });
    if (opts.name) rows.push({ t: "Nama: " + opts.name, f: "600 " + coordF + "px system-ui, sans-serif", c: "#ffd27a" });
    if (!rows.length) rows.push({ t: opts.timeStr || opts.dateStr || "•", f: "800 " + timeF + "px system-ui, sans-serif", c: "#ffffff" });

    const hPx = rows.map((r) => parseInt(r.f, 10));
    const barH = hPx.reduce((a, b) => a + b, 0) + rowGap * (rows.length - 1) + pt + pb;
    const barY = opts.pos === "top" ? 0 : H - barH;

    const logoH = Math.min(60, Math.round(fs * 1.7));
    const logoW = opts.showLogo
      ? (logoReady && logoImg ? Math.round(logoH * (logoImg.width / logoImg.height)) : Math.round(logoH * 1.5))
      : 0;

    dctx.fillStyle = "rgba(0,0,0,0.62)";
    dctx.fillRect(0, barY, W, barH);

    if (opts.showLogo && logoReady && logoImg) {
      const lx = W - logoW - 14;
      const ly = opts.pos === "top" ? pt + 4 : H - pb - logoH;
      dctx.drawImage(logoImg, lx, ly, logoW, logoH);
    }

    let y = barY + pt + hPx[0];
    rows.forEach((r, i) => {
      dctx.font = r.f;
      dctx.fillStyle = r.c;
      dctx.textBaseline = "alphabetic";
      dctx.shadowColor = "rgba(0,0,0,0.9)";
      dctx.shadowBlur = 3;
      dctx.shadowOffsetY = 1;
      dctx.fillText(r.t, pl, y);
      dctx.shadowBlur = 0;
      dctx.shadowOffsetY = 0;
      if (i < rows.length - 1) y += hPx[i + 1] + rowGap;
    });

    if (opts.showCert) {
      dctx.font = "500 " + Math.round(fs * 0.5) + "px 'Roboto Mono','PT Mono',Consolas,monospace,sans-serif";
      const tw = dctx.measureText(opts.cert).width;
      dctx.fillStyle = "rgba(255,255,255,0.55)";
      dctx.textBaseline = "alphabetic";
      const cy = opts.pos === "top" ? barY + pt + timeF + 4 : H - pb;
      dctx.fillText(opts.cert, Math.max(pl, W - tw - pr), cy);
    }
  }

  function draw() {
    if (!img) return;

    const scale = Math.min(1, 1000 / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    cv.width = w;
    cv.height = h;

    // base image
    const opts = buildOptions(new Date());
    ctx.filter = opts.filter;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = "none";
    paintStamp(ctx, w, h, opts);
  }

  // ============ LIVE CAMERA ============
  async function startCamera() {
    stopCamera();
    camFacing = camFacing || "environment";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      show("mode-pick");
      alert("Kamera tidak didukung di browser/WebView ini. Coba mode 'Kamera' biasa atau pakai APK.");
      return;
    }
    try {
      const portrait = window.innerHeight >= window.innerWidth;
      const vw = portrait ? 1080 : 1920;
      const vh = portrait ? 1920 : 1080;
      camStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: camFacing,
          width: { ideal: vw, max: 3264 },
          height: { ideal: vh, max: 3264 },
        },
        audio: false,
      });
    } catch (err) {
      show("mode-pick");
      alert("Kamera tidak bisa dibuka: " + (err && err.message ? err.message : err) +
        "\nPastikan izin kamera diizinkan & gunakan https (di APK otomatis).");
      return;
    }
    const video = $("camvideo");
    video.srcObject = camStream;
    camActive = true;
    camSaving = false;
    show("cam");
    hideCamsave();
    updateCamOverlay();
    if (camTimer) clearInterval(camTimer);
    camTimer = setInterval(updateCamOverlay, 250);
    try { await video.play(); } catch (e) { /* pasrah */ }
  }

  function stopCamera() {
    if (camRecording) stopRecord();
    if (camTimer) { clearInterval(camTimer); camTimer = null; }
    if (camStream) {
      const tracks = camStream.getTracks();
      tracks.forEach((t) => t.stop());
      camStream = null;
    }
    $("camvideo").srcObject = null;
    camActive = false;
  }

  function updateCamOverlay() {
    if (!camActive) return;
    const opts = buildOptions(new Date());

    const recEl = $("camrec");
    recEl.classList.toggle("hidden", !camRecording);
    if (camRecording) {
      const s = Math.floor((Date.now() - recStartT) / 1000);
      recEl.textContent = "● REC " + String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }

    $("camvideo").style.filter = opts.filter;
    const lg = $("camlogo");
    if (opts.showLogo && logoReady && logoImg) {
      lg.src = logoImg.src;
      lg.className = "cam-logo " + (opts.pos === "top" ? "top" : "bottom");
      lg.classList.remove("hidden");
    } else {
      lg.classList.add("hidden");
    }

    const dateEl = $("camdate");
    const gpsEl = $("camgps");
    const timeEl = $("camtime");
    const addrEl = $("camaddr");

    dateEl.classList.toggle("hidden", !opts.showDate);
    if (opts.showDate) dateEl.textContent = "📅 " + opts.dateStr;

    timeEl.classList.toggle("hidden", !opts.showTime);
    if (opts.showTime) timeEl.textContent = opts.timeStr;

    if (opts.showGps) {
      gpsEl.classList.remove("hidden");
      gpsEl.textContent = gps ? "📍 " + opts.gpsStr : "📍 mencari lokasi...";
    } else {
      gpsEl.classList.add("hidden");
    }

    addrEl.classList.toggle("hidden", !opts.address);
    if (opts.address) addrEl.textContent = opts.address;

    const fullEl = $("camaddrfull");
    const nearEl = $("camnear");
    const v = $("camvideo");
    const res = v.videoWidth && v.videoHeight ? "🔧 " + v.videoWidth + "×" + v.videoHeight + " px" : "";
    if (gps) {
      fullEl.textContent = opts.address || "📍 mencari alamat...";
      nearEl.textContent = "±" + Math.round(gps.acc) + " m (" + opts.gpsStr + ")" + (res ? " · " + res : "");
    } else {
      fullEl.textContent = "Aktifkan GPS & izinkan lokasi";
      nearEl.textContent = res || "";
    }
    refreshMap();
  }

  function showCamsave(msg, ok) {
    const el = $("camsave");
    el.textContent = msg;
    el.className = "cam-save visible " + (ok ? "ok" : "err");
    setTimeout(hideCamsave, 2600);
  }
  function hideCamsave() {
    $("camsave").className = "cam-save hidden";
  }

  // ============ VIDEO RECORDER ============
  let camRecording = false;
  let recChunks = [];
  let rec = null;
  let recRAF = 0;
  let recCanvas = null;
  let recCtx = null;
  let recMime = "video/webm";
  let recStartT = 0;
  let recMicStream = null;
  let recUrl = null;
  let recPending = null;
  const REC_FPS = 24;

  function pickVideoMime() {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      const cand = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      for (const m of cand) {
        try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
      }
    }
    return "video/webm";
  }

  function recLoop() {
    if (!camRecording) return;
    const video = $("camvideo");
    recCtx.filter = FILTERS[$("selFilter").value] || "none";
    recCtx.drawImage(video, 0, 0, recCanvas.width, recCanvas.height);
    recCtx.filter = "none";
    paintStamp(recCtx, recCanvas.width, recCanvas.height, buildOptions(new Date()));
    recRAF = requestAnimationFrame(recLoop);
  }

  async function startRecord() {
    if (!camActive || camRecording || camSaving) return;
    const video = $("camvideo");
    if (!video.videoWidth || !video.videoHeight) return;

    const scale = Math.min(1, (parseInt($("selRecQ").value, 10) || 1280) / video.videoWidth);
    const W = Math.round((video.videoWidth * scale) / 2) * 2;
    const H = Math.round((video.videoHeight * scale) / 2) * 2;
    recMime = pickVideoMime();
    recChunks = [];
    recCanvas = document.createElement("canvas");
    recCanvas.width = W;
    recCanvas.height = H;
    recCtx = recCanvas.getContext("2d");

    let stream = null;
    try { stream = recCanvas.captureStream(REC_FPS); } catch (e) {
      showCamsave("Rekam video tidak didukung di perangkat ini.", false);
      return;
    }

    if (!camStream.getAudioTracks().length) {
      try {
        recMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mt = recMicStream.getAudioTracks()[0];
        if (mt && !stream.getAudioTracks().length) stream.addTrack(mt);
      } catch (e) {
        recMicStream = null;
        showCamsave("Mic ditolak — video direkam tanpa suara", false);
      }
    } else if (stream && camStream.getAudioTracks().length) {
      stream.addTrack(camStream.getAudioTracks()[0]);
    }

    try {
      rec = new MediaRecorder(stream, { mimeType: recMime, videoBitsPerSecond: 5000000 });
    } catch (e) {
      try { rec = new MediaRecorder(stream); } catch (e2) {
        showCamsave("MediaRecorder tidak didukung.", false);
        return;
      }
    }

    rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    rec.onstop = () => {
      const isMp4 = recMime.indexOf("mp4") !== -1;
      const type = isMp4 ? "video/mp4" : "video/webm";
      const blob = new Blob(recChunks, { type: type });
      stopRecUI();
      const ext = isMp4 ? ".mp4" : ".webm";
      const name = "video_" + makeVideoTimestamp() + ext;
      openRecPreview(blob, name, type);
    };

    recStartT = Date.now();
    try { rec.start(500); } catch (e) {
      showCamsave("Gagal mulai rekam.", false);
      return;
    }
    camRecording = true;
    playlistBeep(true);
    recRAF = requestAnimationFrame(recLoop);
    $("btnRecord").classList.add("recording");
    $("camrec").classList.remove("hidden");
    $("camrec").textContent = "● REC 00:00";
  }

  function stopRecord() {
    if (!camRecording) return;
    camRecording = false;
    if (recRAF) cancelAnimationFrame(recRAF);
    if (recMicStream) {
      recMicStream.getTracks().forEach((t) => t.stop());
      recMicStream = null;
    }
    try { rec.stop(); } catch (e) {}
  }

  function stopRecUI() {
    rec = null;
    recCanvas = null;
    recCtx = null;
    playlistBeep(false);
    $("btnRecord").classList.remove("recording");
    $("camrec").classList.add("hidden");
  }

  function playlistBeep(start) {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const ac = new A();
      const t0 = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "square";
      o.frequency.value = start ? 880 : 440;
      o.connect(g);
      g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      o.start(t0);
      o.stop(t0 + 0.1);
      setTimeout(() => { try { ac.close(); } catch (e) {} }, 200);
    } catch (e) {}
  }

  function openRecPreview(blob, name, mime) {
    recPending = { blob, name, mime };
    if (recUrl) URL.revokeObjectURL(recUrl);
    recUrl = URL.createObjectURL(blob);
    $("recvideo").src = recUrl;
    show("recplay");
  }

  function closeRecPreview() {
    if (recUrl) {
      URL.revokeObjectURL(recUrl);
      recUrl = null;
    }
    $("recvideo").src = "";
    $("recvideo").pause();
    recPending = null;
  }

  $("recSave").addEventListener("click", () => {
    if (!recPending) return;
    const p = recPending;
    closeRecPreview();
    show("cam");
    saveRecBlob(p.blob, p.name, p.mime);
  });

  $("recDiscard").addEventListener("click", () => {
    closeRecPreview();
    show("cam");
    showCamsave("Rekaman dibuang.", true);
  });

  function saveRecBlob(blob, name, mime) {
    if (isCapacitor) {
      showCamsave("⏳ Menyimpan video...", true);
      nativeSaveVideo(blob, name, mime).then((res) => showCamsave(res.msg, res.ok));
      return;
    }
    webDownload(blob, name);
    showCamsave("⬇️ Video terunduh ke folder Download", true);
  }

  async function nativeSaveVideo(blob, name, mime) {
    try {
      const base64 = await blobToBase64(blob);
      const gs = plugin("GallerySave");
      if (gs && gs.saveVideo) {
        await gs.saveVideo({
          data: base64,
          fileName: name,
          mimeType: mime,
          dateTime: Date.now(),
          latitude: gps ? gps.lat : null,
          longitude: gps ? gps.lon : null,
        });
        return { ok: true, msg: "✅ Video tersimpan ke kamera (DCIM/Camera)." };
      }
    } catch (e) { /* fallback */ }

    try {
      const Filesystem = plugin("Filesystem");
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({ path: name, data: base64, directory: "DOCUMENTS" });
      return { ok: true, msg: "✅ Video tersimpan ke Documents (plugin video tidak aktif)." };
    } catch (err) {
      return { ok: false, msg: "⚠️ Gagal simpan video: " + (err && err.message ? err.message : err) };
    }
  }

  function makeVideoTimestamp() {
    const now = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
      "_" + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds());
  }

  $("btnRecord").addEventListener("click", () => {
    if (camRecording) stopRecord();
    else startRecord();
  });

  $("btnShutter").addEventListener("click", () => {
    if (!camActive || camSaving) return;
    const video = $("camvideo");
    if (!video.videoWidth || !video.videoHeight) return;
    camSaving = true;
    playShutter();

    const w = video.videoWidth;
    const h = video.videoHeight;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext("2d");
    const opts = buildOptions(new Date());
    tctx.filter = opts.filter;
    tctx.drawImage(video, 0, 0, w, h);
    tctx.filter = "none";
    paintStamp(tctx, w, h, opts);

    const name = makeFilename();
    saveCanvas(tmp, name, "camera");
  });

  function playShutter() {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const ac = new A();
      const t0 = ac.currentTime;
      [0, 0.09].forEach((d, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "sine";
        o.frequency.value = i ? 2100 : 1500;
        o.connect(g);
        g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.07);
        o.start(t0 + d);
        o.stop(t0 + d + 0.08);
      });
      setTimeout(() => { try { ac.close(); } catch (e) {} }, 350);
    } catch (e) {}
  }

  $("btnFlip").addEventListener("click", () => {
    camFacing = camFacing === "environment" ? "user" : "environment";
    startCamera();
  });

  $("btnCamBack").addEventListener("click", () => {
    stopCamera();
    hideCamsave();
    show("mode-pick");
  });

  // ============ SAVE ============
  function makeFilename() {
    const now = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const clean = (s) =>
      (s || "").toString().replace(/[\\/:*?"<>|#%&\n]/g, "-").trim().slice(0, 40);
    const dt = now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
      " " + p(now.getHours()) + "." + p(now.getMinutes()) + "." + p(now.getSeconds());
    const addr = clean($("txtAddress").value.trim() || geoAddr);
    const nm = clean($("inpName").value.trim());
    const co = clean($("inpCompany").value.trim());
    const parts = ["timemark", dt,
      addr && addr !== "timemark" ? addr : "",
      nm ? "(Nama-" + nm + ")" : "",
      co ? "(Perusahaan-" + co + ")" : "",
    ];
    return parts.filter(Boolean).join("_") + ".jpg";
  }

  function canvasToBlob(canvas, cb) {
    return canvas.toBlob(cb, "image/jpeg", 0.95);
  }

  function webDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function saveCanvas(canvas, name, from) {
    canvasToBlob(canvas, (blob) => {
      if (!blob) {
        if (from === "camera") { camSaving = false; showCamsave("Gagal memproses gambar!", false); }
        else { $("done-msg").textContent = "Gagal memproses gambar."; show("done"); }
        return;
      }
      if (isCapacitor) {
        nativeSave(blob, name).then((res) => {
          if (from === "camera") {
            camSaving = false;
            showCamsave(res.msg, res.ok);
          } else {
            $("done-msg").textContent = res.msg;
            show("done");
          }
        });
        return;
      }
      webDownload(blob, name);
      if (from === "camera") {
        camSaving = false;
        showCamsave("⬇️ Terunduh ke folder Download", true);
      } else {
        $("done-msg").textContent = '⚠️ Di browser, file terunduh ke folder "Download". Pakai APK versi Capacitor agar otomatis ke galeri.';
        show("done");
      }
    });
  }

  // Native save: MediaStore → galeri/penyimpanan kamera (custom plugin GallerySave),
  // fallback: Filesystem Documents.
  async function nativeSave(blob, name) {
    try {
      const base64 = await blobToBase64(blob);
      const gs = plugin("GallerySave");
      if (gs && gs.save) {
        await gs.save({
          data: base64,
          fileName: name,
          toCamera: true,
          dateTime: Date.now(),
          latitude: gps ? gps.lat : null,
          longitude: gps ? gps.lon : null,
        });
        return { ok: true, msg: "✅ Foto tersimpan ke penyimpanan kamera (DCIM/Camera)." };
      }
    } catch (e) { /* plugin tidak tersedia → fallback */ }

    try {
      const Filesystem = plugin("Filesystem");
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: name,
        data: base64,
        directory: "DOCUMENTS",
      });
      return { ok: true, msg: "✅ Foto tersimpan ke folder Documents (plugin kamera tidak aktif)." };
    } catch (err) {
      return { ok: false, msg: "⚠️ Gagal simpan otomatis: " + (err && err.message ? err.message : err) };
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  $("btnSave").addEventListener("click", () => {
    draw();
    saveCanvas(cv, makeFilename(), "editor");
  });

  $("btnBack").addEventListener("click", () => show("editor"));

  $("btnNew").addEventListener("click", () => {
    img = null;
    gps = null;
    $("fileInput").value = "";
    $("txtAddress").value = "";
    $("inpName").value = "";
    $("inpCompany").value = "";
    show("mode-pick");
    watchGps();
  });

  // live redraw
  ["chkLogo", "chkTime", "chkDate", "chkGps", "txtColor", "selSize", "selPos", "selStyle", "selFilter", "chkCert"].forEach((id) => {
    $(id).addEventListener("change", () => {
      draw();
      if (camActive) updateCamOverlay();
    });
  });

  $("inpLogoFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      const im = new Image();
      im.onload = () => {
        logoImg = im;
        logoReady = true;
        draw();
        if (camActive) updateCamOverlay();
      };
      im.src = ev.target.result;
    };
    r.readAsDataURL(f);
  });

  $("btnLogoClear").addEventListener("click", () => {
    logoImg = null;
    logoReady = false;
    $("inpLogoFile").value = "";
    draw();
    if (camActive) updateCamOverlay();
  });

  $("txtAddress").addEventListener("input", () => { draw(); if (camActive) updateCamOverlay(); });
  ["inpName", "inpCompany"].forEach((id) => {
    $(id).addEventListener("input", () => { draw(); });
  });

  // Template stempel: deretan chip visual (tiruan konsep picker)
  const TEMPLATES = [
    { v: "classic", n: "Normal", d: "Bar penuh, jam besar" },
    { v: "gedo", n: "GEDO", d: "Blok kiri, jam besar" },
    { v: "timemark", n: "Timemark Asli", d: "Bar bawah lebar" },
    { v: "plain", n: "Tanpa Bar", d: "Teks langsung" },
    { v: "compact", n: "Blok Kanan", d: "Kecil di pojok" },
  ];
  function tplThumb(v) {
    const c = document.createElement("canvas");
    c.width = 72; c.height = 52;
    const g = c.getContext("2d");
    g.fillStyle = "#2a2a2e"; g.fillRect(0, 0, 72, 52);
    g.fillStyle = "#fff";
    if (v === "timemark") {
      g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(0, 0, 72, 52);
      g.font = "700 20px sans-serif"; g.fillText("10:21", 8, 46);
      g.fillStyle = "#b0c4d8"; g.font = "9px sans-serif";
      g.fillText("14-02-2026 Jl. Raya", 8, 16); g.fillText("Nama / Perusahaan", 8, 29);
    } else if (v === "gedo") {
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 12, 62, 40);
      g.fillStyle = "#fff"; g.font = "800 20px sans-serif"; g.fillText("10:21:47", 5, 42);
      g.fillStyle = "#b0c4d8"; g.font = "9px sans-serif"; g.fillText("14-02-2026", 5, 8);
    } else if (v === "compact") {
      g.fillStyle = "rgba(0,0,0,.55)";
      roundRect(g, 34, 4, 34, 44, 6); g.fill();
      g.fillStyle = "#fff"; g.font = "800 12px sans-serif"; g.fillText("10:21", 37, 20);
      g.fillStyle = "#b0c4d8"; g.font = "7px sans-serif";
      g.fillText("Jalan 1", 37, 29); g.fillText("Nama", 37, 37);
    } else if (v === "plain") {
      g.font = "800 20px sans-serif"; g.fillText("10:21", 6, 38);
      g.fillStyle = "#b0c4d8"; g.font = "9px sans-serif";
      g.fillText("14-02-2026 Jl. Raya", 6, 12); g.fillText("Nama", 6, 25);
    } else {
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 26, 72, 26);
      g.fillStyle = "#fff"; g.font = "800 22px sans-serif"; g.fillText("10:21", 6, 49);
      g.fillStyle = "#b0c4d8"; g.font = "9px sans-serif";
      g.fillText("14-02-2026 Jl. Raya", 6, 14); g.fillText("Nama", 6, 24);
    }
    return c;
  }
  function initTplGrid() {
    const grid = $("tpl-grid");
    grid.innerHTML = "";
    TEMPLATES.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tpl-chip";
      b.dataset.v = t.v;
      b.title = t.d;
      b.appendChild(tplThumb(t.v));
      const lb = document.createElement("span");
      lb.className = "tpl-name";
      lb.textContent = t.n;
      b.appendChild(lb);
      b.addEventListener("click", () => {
        $("selStyle").value = t.v;
        TEMPLATES.forEach((o) =>
          grid.querySelector('[data-v="' + o.v + '"]').classList.toggle("active", o.v === t.v)
        );
        try { localStorage.setItem("tm_style", t.v); } catch (e) {}
        draw();
        if (camActive) updateCamOverlay();
      });
      grid.appendChild(b);
    });
    TEMPLATES.forEach((o) =>
      grid.querySelector('[data-v="' + o.v + '"]').classList.toggle("active", o.v === $("selStyle").value)
    );
  }
  try { const s = localStorage.getItem("tm_style"); if (s && $("selStyle").querySelector('option[value="' + s + '"]')) $("selStyle").value = s; } catch (e) {}
  initTplGrid();

  // Always show GPS status box whenever editor is visible
  const origShow = show;
  show = function (name) {
    origShow(name);
    if (name === "editor") {
      $("gps-box").classList.remove("hidden");
    }
  };

  watchGps();

  // Live clock: stempel di galeri ikut berjalan tiap detik seperti timestamp camera
  setInterval(() => { if (img) draw(); }, 500);
})();
