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

  const screens = ["mode-pick", "editor", "done", "cam", "about"];
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
    try {
      const plugin = window.Capacitor.Plugins.Camera;
      if (!plugin) {
        alert("Plugin Camera tidak tersedia. Pastikan @capacitor/camera terpasang.");
        return;
      }
      const source = mode === "camera" ? "CAMERA" : "PHOTOS";
      const photo = await plugin.getPhoto({
        quality: 95,
        allowEditing: false,
        resultType: "DATA_URL",
        source,
        correctOrientation: true,
      });

      if (photo && photo.dataUrl) {
        const im = new Image();
        im.onload = () => {
          img = im;
          draw();
          show("editor");
          $("gps-box").classList.remove("hidden");
          watchGps();
        };
        im.src = photo.dataUrl;
      }
    } catch (err) {
      alert("Gagal mengambil foto: " + (err && err.message ? err.message : err));
    }
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
      },
      (err) => {
        $("gps-status").textContent = "Lokasi belum tersedia. Aktifkan GPS & izinkan lokasi.";
        updateCamOverlay();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
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
      address: $("txtAddress").value.trim(),
      showLogo: $("chkLogo").checked,
      showTime: $("chkTime").checked,
      showDate: $("chkDate").checked,
      showGps: $("chkGps").checked,
      pos: $("selPos").value,
      color: $("txtColor").value,
      size: parseInt($("selSize").value, 10) || 48,
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

  function paintStamp(dctx, W, H, opts) {
    // relative font size
    const fs = Math.max(20, Math.min(90, (opts.size / 48) * Math.max(22, H * 0.045)));

    // ---- build stamp lines ----
    const lines = [];
    if (opts.showTime) lines.push(opts.timeStr);
    if (opts.showDate) lines.push(opts.dateStr);
    if (opts.showGps && opts.gpsStr) lines.push(opts.gpsStr);
    if (opts.address) {
      dctx.font = "600 " + Math.round(fs) + "px system-ui, sans-serif";
      const wrapped = wrapText(opts.address, W - 90);
      wrapped.forEach((l) => lines.push(l));
    }

    const lineH = Math.round(fs * 1.4);

    // ---- footer/header sized to content ----
    const logoWidth = opts.showLogo ? Math.round(fs * 1.5) + 14 : 0;
    const barH = lines.length * lineH + 24;
    const barY = opts.pos === "top" ? 0 : H - barH;
    dctx.fillStyle = "rgba(0,0,0,0.55)";
    dctx.fillRect(0, barY, W, barH);

    // ---- logo badge ----
    let x = 18;
    const baseY = opts.pos === "top" ? barH : H - barH;
    if (opts.showLogo) {
      dctx.save();
      dctx.fillStyle = "#ff9500";
      dctx.font = "800 " + Math.round(fs * 1.2) + "px system-ui, sans-serif";
      dctx.textBaseline = "alphabetic";
      dctx.fillText("TM", x, opts.pos === "top" ? Math.round(fs * 1.0) + 10 : baseY + Math.round(fs * 1.0) + 6);
      dctx.restore();
      x += (logoWidth - 4);
    }

    // ---- text lines ----
    dctx.textBaseline = "alphabetic";
    let y = opts.pos === "top"
      ? Math.round(fs * 1.0) + 14
      : baseY + Math.round(fs * 1.0) + 14;
    dctx.font = "700 " + Math.round(fs) + "px system-ui, sans-serif";
    dctx.fillStyle = opts.color;
    for (const ln of lines) {
      dctx.fillText(ln, x, y);
      y += lineH;
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
    ctx.drawImage(img, 0, 0, w, h);
    paintStamp(ctx, w, h, buildOptions(new Date()));
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
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: camFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
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

  $("btnShutter").addEventListener("click", () => {
    if (!camActive || camSaving) return;
    const video = $("camvideo");
    if (!video.videoWidth || !video.videoHeight) return;
    camSaving = true;

    const w = video.videoWidth;
    const h = video.videoHeight;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(video, 0, 0, w, h);
    paintStamp(tctx, w, h, buildOptions(new Date()));

    const name = makeFilename();
    saveCanvas(tmp, name, "camera");
  });

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
    return (
      "timemark_" +
      now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
      "_" + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds()) +
      ".jpg"
    );
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
        await gs.save({ data: base64, fileName: name, toCamera: true });
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
    show("mode-pick");
    watchGps();
  });

  // live redraw
  ["chkLogo", "chkTime", "chkDate", "chkGps", "txtColor", "selSize", "selPos"].forEach((id) => {
    $(id).addEventListener("change", draw);
    $(id).addEventListener("input", draw);
  });
  $("txtAddress").addEventListener("input", () => { draw(); if (camActive) updateCamOverlay(); });

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
