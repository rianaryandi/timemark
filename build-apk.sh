#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Build APK "Timemark Foto" via Termux
#  Jalankan:  bash build-apk.sh
# ============================================================
set -e

echo "=============================================="
echo "  TIMEMARK FOTO — BUILD APK (Termux)"
echo "=============================================="

# ---------- 1. Update & install tools ----------
echo ""
echo "[1/6] Cek/install paket dasar..."
pkg update -y
pkg install -y nodejs-lts openjdk-17 git wget unzip python || \
  pkg install -y nodejs openjdk-17 git wget unzip python

# ---------- 2. Android SDK via Termux sdks ----------
echo ""
echo "[2/6] Siapkan Android SDK (sdkmanager)..."
SDK_DIR="$HOME/android-sdk"
CMDLINE_TOOLS="$SDK_DIR/cmdline-tools/latest"
if [ ! -d "$CMDLINE_TOOLS" ]; then
  mkdir -p "$SDK_DIR/cmdline-tools"
  echo "    Downloading commandlinetools (linux)..."
  TMP_ZIP="$HOME/cmdline-tools.zip"
  wget -q --show-progress \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" \
    -O "$TMP_ZIP"
  unzip -q "$TMP_ZIP" -d "$SDK_DIR/cmdline-tools"
  mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$CMDLINE_TOOLS"
  rm -f "$TMP_ZIP"
fi

export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$PATH:$CMDLINE_TOOLS/bin"

echo "    Accept licenses & install platform/build-tools..."
yes 2>/dev/null | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null 2>&1 || \
  sdkmanager "platform-tools" "platforms;android-33" "build-tools;33.0.0" >/dev/null 2>&1

# ---------- 3. Setup java ----------
echo ""
echo "[3/6] Java env..."
export JAVA_HOME="$PREFIX"
export PATH="$PREFIX/bin:$PATH"
java -version 2>&1 | head -1

# ---------- 4. Install npm deps & add cap android ----------
echo ""
echo "[4/6] npm install + Capacitor..."
if [ ! -d "node_modules" ]; then
  npm install
fi

if [ ! -d "android" ]; then
  npx cap add android
fi
npx cap sync android

# ---------- 5. Inject AndroidManifest permissions ----------
echo ""
echo "[5/6] Tambah izin AndroidManifest..."
MF="android/app/src/main/AndroidManifest.xml"
if [ -f "$MF" ] && ! grep -q "ACCESS_FINE_LOCATION" "$MF"; then
  sed -i 's#<application#<uses-permission android:name="android.permission.CAMERA"/>\n    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/>\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/>\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28"/>\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>\n    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>\n\n    <application#' "$MF"
  echo "    Izin ditambahkan."
else
  echo "    Izin sudah ada/lewat."
fi

# ---------- 6. Build APK ----------
echo ""
echo "[6/6] Build APK debug..."
cd android
chmod +x gradlew 2>/dev/null || true
./gradlew assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "=============================================="
if [ -f "$APK_PATH" ]; then
  echo "  ✅ BUILD BERHASIL!"
  cp "$APK_PATH" "$HOME/../storage/downloads/timemark-foto.apk" 2>/dev/null || \
    cp "$APK_PATH" "$PWD/timemark-foto.apk"
  echo "  File APK:"
  echo "   - $PWD/$APK_PATH"
  echo "   - (disalin) timemark-foto.apk"
else
  echo "  ❌ APK tidak ditemukan. Periksa error di atas."
fi
echo "=============================================="
