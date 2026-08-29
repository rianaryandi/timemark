(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const cv = $("cv");
  const ctx = cv.getContext("2d");

  let img = null;          // current source image (HTMLImageElement)
  let gps = null;          // {lat, lon, accuracy}
  let isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  const screens = ["mode-pick", "editor", "done"];
  function show(name) {
    screens.forEach((s) => $(s).classList.toggle("active", s === name));
  }

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
      if (isCapacitor) {
        pickFromNative(mode);
        return;
      }
      const fi = $("fileInput");
      if (mode === "camera") {
        fi.setAttribute("capture", "environment");
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
      },
      (err) => {
        $("gps-status").textContent = "Lokasi belum tersedia. Aktifkan GPS & izinkan lokasi.";
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
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

  function draw() {
    if (!img) return;

    const scale = Math.min(1, 1000 / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    cv.width = w;
    cv.height = h;

    // base image
    ctx.drawImage(img, 0, 0, w, h);

    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const dateStr = now.toLocaleDateString("id-ID", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });

    const showLogo = $("chkLogo").checked;
    const showTime = $("chkTime").checked;
    const showDate = $("chkDate").checked;
    const showGps = $("chkGps").checked;
    const address = $("txtAddress").value.trim();
    const pos = $("selPos").value;
    const color = $("txtColor").value;
    const size = parseInt($("selSize").value, 10) || 48;

    // font size relative to image height
    const fs = Math.max(20, Math.min(90, (size / 48) * Math.max(22, h * 0.045)));

    // ---- build stamp lines ----
    const lines = [];
    if (showTime) lines.push(timeStr);
    if (showDate) lines.push(dateStr);
    if (showGps && gps) lines.push(gps.lat.toFixed(6) + ", " + gps.lon.toFixed(6));
    if (address) {
      ctx.font = "600 " + Math.round(fs) + "px system-ui, sans-serif";
      const wrapped = wrapText(address, w - 90);
      wrapped.forEach((l) => lines.push(l));
    }

    const lineH = Math.round(fs * 1.4);

    // ---- footer/header sized to content ----
    const logoWidth = showLogo ? Math.round(fs * 1.5) + 14 : 0;
    const barH = lines.length * lineH + 24;
    const barY = pos === "top" ? 0 : h - barH;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, barY, w, barH);

    // ---- logo badge ----
    let x = 18;
    let baseY = pos === "top" ? barH : h - barH;
    if (showLogo) {
      ctx.save();
      ctx.fillStyle = "#ff9500";
      ctx.font = "800 " + Math.round(fs * 1.2) + "px system-ui, sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("TM", x, pos === "top" ? Math.round(fs * 1.0) + 10 : baseY + Math.round(fs * 1.0) + 6);
      ctx.restore();
      x += (logoWidth - 4);
    }

    // ---- text lines ----
    ctx.textBaseline = "alphabetic";
    let y = pos === "top"
      ? Math.round(fs * 1.0) + 14
      : baseY + Math.round(fs * 1.0) + 14;
    ctx.font = "700 " + Math.round(fs) + "px system-ui, sans-serif";
    ctx.fillStyle = color;
    for (const ln of lines) {
      ctx.fillText(ln, x, y);
      y += lineH;
    }
  }

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

  function canvasToBlob(cb) {
    return cv.toBlob(cb, "image/jpeg", 0.95);
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

  // Native save to gallery via Capacitor Filesystem
  async function nativeSave(blob, name) {
    try {
      const Filesystem = plugin("Filesystem");
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: name,
        data: base64,
        directory: "DOCUMENTS",
      });
      // Save to pictures album using Media plugin (if available)
      try {
        const Media = plugin("Media");
        await Media.savePhoto({
          fileName: name,
          albumIdentifier: undefined,
        });
      } catch (e) {
        // Media plugin optional - fallback docs folder
      }
      $("done-msg").textContent = "✅ Foto tersimpan ke galeri (Documents/Pictures).";
    } catch (err) {
      $("done-msg").textContent = "⚠️ Gagal simpan otomatis: " + (err && err.message ? err.message : err);
    }
    show("done");
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
    const name = makeFilename();

    if (isCapacitor) {
      canvasToBlob((blob) => {
        if (blob) nativeSave(blob, name);
        else { $("done-msg").textContent = "Gagal memproses gambar."; show("done"); }
      });
      return;
    }

    // Web: download
    canvasToBlob((blob) => {
      if (blob) webDownload(blob, name);
    });
    $("done-msg").textContent = '⚠️ Di browser, file terunduh ke folder "Download". Pakai APK versi Capacitor agar otomatis ke galeri.';
    show("done");
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
  $("txtAddress").addEventListener("input", draw);

  // Always show GPS status box whenever editor is visible
  const origShow = show;
  show = function (name) {
    origShow(name);
    if (name === "editor") {
      $("gps-box").classList.remove("hidden");
    }
  };

  watchGps();
})();
