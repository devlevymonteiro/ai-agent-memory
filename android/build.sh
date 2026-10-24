#!/usr/bin/env bash
# =============================================================================
#  build.sh — gera o APK do BRASA sem Android Studio / Gradle / SDK do Google.
#
#  Usa um toolchain minimalista montado em tools/setup-toolchain.sh:
#    - aapt2  (nativo Linux, do pacote npm aaptjs3)
#    - ecj    (compilador Java, roda em JRE)
#    - R8/D8  (gera classes.dex)
#    - android.jar (stubs da API)
#    - apksigner + chave gerada via openssl
#
#  Uso:  ./android/build.sh
#  Variaveis:
#    TC      diretorio do toolchain (padrao: tools/.toolchain)
#    OUT     arquivo APK de saida  (padrao: na raiz do repo)
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TC="${TC:-$ROOT/tools/.toolchain}"
OUT="${OUT:-$ROOT/BRASA.apk}"

JAVA="$TC/jre/bin/java"
AAPT2="$TC/bin/aapt2"
ANDROID_JAR="$TC/tools/android.jar"
ECJ="$TC/tools/ecj-3.45.0.jar"
D8="$TC/tools/d8.jar"
APKSIGNER="$TC/tools/apksigner.jar"

for f in "$JAVA" "$AAPT2" "$ANDROID_JAR" "$ECJ" "$D8" "$APKSIGNER"; do
  [ -f "$f" ] || { echo "ERRO: toolchain incompleto, falta: $f"; echo "Rode: bash tools/setup-toolchain.sh"; exit 1; }
done
chmod +x "$JAVA" "$AAPT2" 2>/dev/null || true

BUILD="$HERE/.build"
rm -rf "$BUILD"
mkdir -p "$BUILD/res" "$BUILD/classes" "$BUILD/dex" "$BUILD/keys"

echo "[1/6] compilando recursos (aapt2 compile)..."
"$AAPT2" compile --dir "$HERE/res" -o "$BUILD/res/res.zip"

echo "[2/6] linkando manifest/recursos/assets (aapt2 link)..."
"$AAPT2" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" \
  -A "$ROOT/game" \
  --auto-add-overlay \
  --min-sdk-version 21 \
  --target-sdk-version 28 \
  "$BUILD/res/res.zip"

echo "[3/6] compilando Java (ecj)..."
mapfile -t SRCS < <(find "$HERE/src" -name '*.java')
"$JAVA" -jar "$ECJ" -source 8 -target 8 -encoding UTF-8 -nowarn \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" \
  "${SRCS[@]}"

echo "[4/6] gerando DEX (R8/D8)..."
mapfile -t CLASSFILES < <(find "$BUILD/classes" -name '*.class')
"$JAVA" -cp "$D8" com.android.tools.r8.D8 \
  --release \
  --min-api 21 \
  --lib "$ANDROID_JAR" \
  --output "$BUILD/dex" \
  "${CLASSFILES[@]}"

echo "[5/6] montando APK (zip)..."
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
( cd "$BUILD/dex" && zip -q -u ../unsigned.apk classes.dex )

echo "[6/6] assinando (apksigner v1+v2)..."
KEY="$BUILD/keys/key.pk8"
CERT="$BUILD/keys/cert.pem"
if [ ! -f "$HERE/signing.key" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$HERE/signing.key" -out "$HERE/signing.crt" \
    -days 10000 -subj "/C=BR/ST=DF/L=Brasilia/O=Brasa/OU=Game/CN=Brasa Dev" \
    >/dev/null 2>&1
fi
openssl pkcs8 -topk8 -nocrypt -in "$HERE/signing.key" -outform DER -out "$KEY" 2>/dev/null
openssl x509 -in "$HERE/signing.crt" -outform PEM -out "$CERT" 2>/dev/null

"$JAVA" -jar "$APKSIGNER" sign \
  --key "$KEY" --cert "$CERT" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled false \
  --v4-signing-enabled false \
  --out "$OUT" \
  "$BUILD/unsigned.apk"

"$JAVA" -jar "$APKSIGNER" verify --verbose "$OUT" | sed -n '1,12p'

echo ""
echo "OK -> $OUT ($(wc -c < "$OUT") bytes)"
