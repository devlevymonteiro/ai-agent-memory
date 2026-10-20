#!/usr/bin/env bash
# Build de release do Xadrez 3D.
#   export headless (sem assinatura) -> zipalign -> apksigner -> Downloads do Windows
#
# Requisitos de ambiente:
#   export KS_PASS='senha-da-keystore'          # obrigatorio
#   export KS="$HOME/keystores/xadrez3d-release.keystore"   # opcional
#   export KS_ALIAS="xadrez3d"                              # opcional
#
# Uso:
#   ./tools/build_android.sh              -> APK assinado de release
#   ./tools/build_android.sh debug        -> APK de debug (debug keystore, nao assinado p/ producao)
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$HOME/dev/build}"
GODOT="${GODOT:-$HOME/tools/godot/godot}"
PRESET="${PRESET:-Android}"
APP_NAME="${APP_NAME:-xadrez3d}"
MODE="${1:-release}"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
if [ ! -d "$SDK/build-tools" ]; then
	echo "ERRO: Android SDK nao encontrado em $SDK"
	exit 1
fi
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -n1)"

KS="${KS:-$HOME/keystores/xadrez3d-release.keystore}"
KS_ALIAS="${KS_ALIAS:-xadrez3d}"

cd "$PROJECT_DIR"
mkdir -p "$BUILD_DIR"

VERSION="$(grep -oP '(?<=config/version=")[^"]+' project.godot 2>/dev/null || echo '1.0.0')"
STAMP="$(date +%Y%m%d-%H%M)"

echo "── projeto : $PROJECT_DIR"
echo "── godot   : $($GODOT --headless --version 2>/dev/null || echo 'NAO ENCONTRADO')"
echo "── sdk     : $SDK"
echo "── build-tools: $(basename "$BT")"

case "$MODE" in
	debug)
		OUT="$BUILD_DIR/${APP_NAME}-debug-${STAMP}.apk"
		"$GODOT" --headless --export-debug "$PRESET" "$OUT"
		;;

	release)
		if [ -z "${KS_PASS:-}" ]; then
			echo "ERRO: defina a senha da keystore:  export KS_PASS='...'"
			exit 1
		fi
		if [ ! -f "$KS" ]; then
			echo "ERRO: keystore nao encontrada: $KS"
			echo "      crie com: keytool -genkey -v -keystore \$KS -alias \$KS_ALIAS -keyalg RSA -keysize 2048 -validity 10000"
			exit 1
		fi
		export KS_PASS

		UNSIGNED="$BUILD_DIR/${APP_NAME}-unsigned.apk"
		ALIGNED="$BUILD_DIR/${APP_NAME}-aligned.apk"
		OUT="$BUILD_DIR/${APP_NAME}-v${VERSION}-${STAMP}.apk"

		# 1) export (preset com package/signed=false -> APK sem assinatura)
		"$GODOT" --headless --export-release "$PRESET" "$UNSIGNED"
		if [ ! -f "$UNSIGNED" ]; then
			echo "ERRO: export nao gerou APK."
			echo "  - preset '$PRESET' existe? (Projeto > Exportar > Adicionar > Android)"
			echo "  - export templates em ~/.local/share/godot/export_templates/<versao>?"
			exit 1
		fi

		# 2) alinhamento obrigatorio antes de assinar
		"$BT/zipalign" -f -p 4 "$UNSIGNED" "$ALIGNED"

		# 3) assinatura v1+v2+v3
		rm -f "$OUT"
		"$BT/apksigner" sign \
			--ks "$KS" \
			--ks-key-alias "$KS_ALIAS" \
			--ks-pass env:KS_PASS \
			--key-pass env:KS_PASS \
			--out "$OUT" "$ALIGNED"

		# 4) verificacao
		"$BT/apksigner" verify --verbose "$OUT" | grep -Ei "Verifies|WARNING|ERROR" || true

		rm -f "$UNSIGNED" "$ALIGNED"
		;;

	*)
		echo "modo invalido: use 'release' ou 'debug'"
		exit 1
		;;
esac

if [ ! -f "$OUT" ]; then
	echo "ERRO: APK final nao foi gerado."
	exit 1
fi

# 5) permissoes realmente presentes no manifest (Play Protect olha isso)
echo "── permissoes no manifest:"
if "$BT/aapt2" dump badging "$OUT" 2>/dev/null | grep -i "uses-permission:"; then
	echo "   ^^ confira se alguma nao e estritamente necessaria"
else
	echo "   (nenhuma — ideal)"
fi

# 6) copia para o Windows
FINAL_WIN="xadrez3d-final.apk"
WIN_USER="$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r\n' || true)"
if [ -z "$WIN_USER" ]; then
	WIN_USER="$(ls /mnt/c/Users 2>/dev/null | grep -vE '^(Public|Default|Default User|All Users|desktop.ini)$' | head -n1 || true)"
fi

if [ -n "$WIN_USER" ] && [ -d "/mnt/c/Users/$WIN_USER/Downloads" ]; then
	cp "$OUT" "/mnt/c/Users/$WIN_USER/Downloads/$FINAL_WIN"
	echo "── copiado : C:\\Users\\$WIN_USER\\Downloads\\$FINAL_WIN"
else
	echo "AVISO: nao achei /mnt/c/Users/<usuario>/Downloads."
	echo "       APK ficou em: $OUT"
fi

ls -lh "$OUT"
