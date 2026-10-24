#!/usr/bin/env bash
# =============================================================================
#  setup-toolchain.sh — monta o toolchain Android minimalista.
#
#  Tudo vem do registro npm (permitido no sandbox). Nao depende de
#  dl.google.com, Android Studio, Gradle, apt ou JDK do sistema.
#
#  Pacotes usados:
#    aaptjs3            -> binario nativo aapt2 (Linux x64)
#    javajre-linux-64   -> JRE 17 embutido (para ecj / d8 / apksigner)
#    @drxiaozhi/minapk  -> android.jar, d8.jar, apksigner.jar, ecj.jar
#
#  Uso:  bash tools/setup-toolchain.sh [DIR_DESTINO]
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TC="${1:-$ROOT/tools/.toolchain}"

echo "Toolchain em: $TC"
mkdir -p "$TC/bin" "$TC/tools"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # fetch <pkg> <tgz-name>
  local pkg="$1" out="$2"
  echo ">> npm pack $pkg"
  ( cd "$TMP" && npm pack "$pkg" >/dev/null 2>&1 )
  echo "$TMP/$out"
}

echo "==> Baixando pacotes do npm registry..."
AAPT_TGZ="$(fetch aaptjs3@2.0.2 aaptjs3-2.0.2.tgz)"
JRE_TGZ="$(fetch javajre-linux-64@17.0.8 javajre-linux-64-17.0.8.tgz)"
MIN_TGZ="$(fetch @drxiaozhi/minapk@0.5.0 drxiaozhi-minapk-0.5.0.tgz)"

echo "==> Extraindo JRE 17..."
mkdir -p "$TMP/jre"
tar xzf "$JRE_TGZ" -C "$TMP/jre"
rm -rf "$TC/jre"
mv "$TMP/jre/package/jre" "$TC/jre"
chmod -R u+rwX "$TC/jre"

echo "==> Extraindo aapt2 (nativo Linux)..."
mkdir -p "$TMP/aapt"
tar xzf "$AAPT_TGZ" -C "$TMP/aapt"
cp "$TMP/aapt/package/bin/x64/linux/aapt2" "$TC/bin/aapt2"
chmod +x "$TC/bin/aapt2"

echo "==> Extraindo android.jar / d8 / apksigner / ecj..."
mkdir -p "$TMP/min"
tar xzf "$MIN_TGZ" -C "$TMP/min"
cp "$TMP/min/package/tools/android.jar"      "$TC/tools/"
cp "$TMP/min/package/tools/d8.jar"           "$TC/tools/"
cp "$TMP/min/package/tools/apksigner.jar"    "$TC/tools/"
cp "$TMP/min/package/tools/ecj-3.45.0.jar"  "$TC/tools/"

echo ""
echo "Toolchain pronto!"
"$TC/jre/bin/java" -version 2>&1 | head -2
"$TC/bin/aapt2" version
echo ""
echo "Agora rode: bash android/build.sh"
