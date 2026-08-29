# Timemark Foto — Stempel Foto dari Galeri & Kamera

Aplikasi Android untuk **menstempel foto** dengan **waktu & tanggal, koordinat GPS, teks bebas/alamat, dan logo**, dari **galeri** atau **kamera**.

Dibangun dari nol (HTML + CSS + JS + PWA), siap dibungkus jadi APK Android.

## Cara pakai (instan, tanpa build APK)

Aplikasi ini adalah **PWA** — bisa langsung dijalankan di HP tanpa perlu APK:

1. Upload folder ini ke hosting statis (mis. Netlify Drop, GitHub Pages) ATAU jalankan lokal.
2. Buka di Chrome Android → menu ⋮ → **"Tambahkan ke layar utama"** → aplikasi berjalan fullscreen seperti app.

## Fitur

- 🖼️ **Dari galeri** atau 📷 **kamera** (keduanya didukung)
- ⏰ Stempel **waktu & tanggal** otomatis
- 📍 Stempel **koordinat GPS** (live)
- ✏️ **Teks bebas / alamat** custom
- 🎨 **Warna & ukuran** stempel, plus **logo** "TM"
- 💾 Simpan hasil (JPEG)

## Cara build jadi APK Android (Capacitor)

Butuh: **Node.js**, **Java 17+**, **Android Studio / Android SDK**.

### Cara A — Otomatis di HP via Termux (disarankan)

Ada skrip siap pakai `build-apk.sh` yang menangani semuanya (install java/sdk, setup capacitor,
tambah izin, build). Jalankan di Termux:

```bash
# pastikan sudah ada folder project ini di HP, lalu:
bash build-apk.sh
```

Hasil APK: `storage/downloads/timemark-foto.apk` (folder Download HP).

### Cara B — Manual (PC)

```bash
# 1. Install dependensi & Capacitor
npm install
npx cap add android

# 2. Sinkronkan web ke project android
npx cap sync android

# 3. Build APK debug
cd android && ./gradlew assembleDebug
# APK di: android/app/build/outputs/apk/debug/app-debug.apk
```

Atau buka dengan Android Studio: `npx cap open android` → Run ▶️.

Plugin yang dipakai kode dan sudah masuk `package.json`:
- `@capacitor/camera` — ambil foto dari kamera/galeri
- `@capacitor/filesystem` — tulis file hasil
- `@capacitor/media` *(opsional, untuk simpan otomatis ke album/galeri)*

> Kode `js/app.js` sudah mendeteksi `window.Capacitor` secara otomatis. Saat dibungkus jadi APK, foto tersimpan langsung ke galeri/album. Saat dibuka sebagai web/browser biasa, hasilnya terunduh ke folder Download.

## Catatan izin (APK)

Tambahkan di `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```
