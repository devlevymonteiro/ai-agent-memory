#!/usr/bin/env bash
# Instala TUDO que o build Android precisa no WSL. Idempotente: pode rodar
# quantas vezes quiser, só refaz o que estiver faltando.
#
#   ./tools/setup_toolchain.sh
#
# Depois disso:  export KS_PASS='...' && ./tools/build_android.sh release
set -euo pipefail

GODOT_DIR="$HOME/tools/godot"
GODOT="$GODOT_DIR/godot"
SDK="$HOME/Android/Sdk"
TEMPLATE_DIR="$HOME/.local/share/godot/export_templates"
KS="$HOME/keystores/xadrez3d-release.keystore"

ok()   { echo "  [ok] $1"; }
step() { echo; echo "── $1"; }

# ---------------------------------------------------------------- pacotes --
step "pacotes do sistema"
if ! command -v unzip >/dev/null || ! command -v zip >/dev/null || ! java -version 2>&1 | grep -q 'version'; then
	sudo apt update -qq
	sudo apt install -y -qq unzip zip curl wget openjdk-17-jdk
	ok "unzip/zip/curl/wget/openjdk-17"
else
	ok "pacotes ja presentes"
fi

# ------------------------------------------------------------------ godot --
step "Godot 4"
if [ ! -x "$GODOT" ]; then
	VER="$(curl -s https://api.github.com/repos/godotengine/godot/releases/latest \
		| grep -oP '"tag_name": "\K[^"]+')"
	echo "  versao: $VER"
	mkdir -p "$GODOT_DIR"
	curl -L --fail -o /tmp/godot.zip \
		"https://github.com/godotengine/godot/releases/download/${VER}/Godot_v${VER}_linux.x86_64.zip"
	unzip -oq /tmp/godot.zip -d "$GODOT_DIR"
	mv "$GODOT_DIR/Godot_v${VER}_linux.x86_64" "$GODOT" 2>/dev/null || true
	chmod +x "$GODOT"
	rm -f /tmp/godot.zip
	ok "godot em $GODOT"
else
	ok "godot ja instalado"
fi
SEMVER="$("$GODOT" --headless --version)"
echo "  build: $SEMVER"

# ------------------------------------------------------- export templates --
step "export templates"
if [ ! -d "$TEMPLATE_DIR/${SEMVER%\.stable}.stable" ] && [ ! -d "$TEMPLATE_DIR/$SEMVER" ]; then
	TAG="$(curl -s https://api.github.com/repos/godotengine/godot/releases/latest \
		| grep -oP '"tag_name": "\K[^"]+')"
	curl -L --fail -o /tmp/tpz \
		"https://github.com/godotengine/godot/releases/download/${TAG}/Godot_v${TAG}_export_templates.tpz"
	mkdir -p /tmp/godot_tpl
	unzip -oq /tmp/tpz -d /tmp/godot_tpl
	mkdir -p "$TEMPLATE_DIR"
	mv /tmp/godot_tpl/templates "$TEMPLATE_DIR/$SEMVER"
	rm -rf /tmp/godot_tpl /tmp/tpz
	ok "templates em $TEMPLATE_DIR/$SEMVER"
else
	ok "templates ja instalados"
fi

# ---------------------------------------------------------------- android --
step "Android SDK"
mkdir -p "$SDK/cmdline-tools"
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
	curl -L --fail -o /tmp/cmdtools.zip \
		https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
	rm -rf /tmp/cmdtools
	unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools
	rm -rf "$SDK/cmdline-tools/latest"
	mv /tmp/cmdtools/cmdline-tools "$SDK/cmdline-tools/latest"
	rm -rf /tmp/cmdtools /tmp/cmdtools.zip
	ok "commandline-tools"
else
	ok "commandline-tools ja presente"
fi

SKDM="$SDK/cmdline-tools/latest/bin/sdkmanager"
yes 2>/dev/null | "$SKDM" --sdk_root="$SDK" --licenses >/dev/null || true
"$SKDM" --sdk_root="$SDK" \
	"platform-tools" "build-tools;35.0.0" "platforms;android-35" >/dev/null
ok "platform-tools + build-tools;35.0.0 + platforms;android-35"

# ------------------------------------------------------------- keystores --
step "keystores"
mkdir -p "$HOME/keystores" && chmod 700 "$HOME/keystores"

if [ ! -f "$HOME/.android/debug.keystore" ]; then
	mkdir -p "$HOME/.android"
	keytool -keyalg RSA -genkeypair -alias androiddebugkey -keypass android -storepass android \
		-dname "CN=Android Debug,O=Android,C=US" -validity 9999 \
		-keystore "$HOME/.android/debug.keystore" >/dev/null 2>&1
	ok "debug.keystore"
else
	ok "debug.keystore ja existe"
fi

if [ ! -f "$KS" ]; then
	echo
	echo "  ATENCAO: a keystore de RELEASE sera criada agora."
	echo "  A senha NAO pode ser recuperada. Guarde num gerenciador."
	echo
	read -rsp "  senha da keystore: " KS_PASS_IN; echo
	read -rsp "  confirme a senha : " KS_PASS_CF; echo
	[ "$KS_PASS_IN" = "$KS_PASS_CF" ] || { echo "  senhas diferentes, abortando"; exit 1; }

	keytool -genkey -v \
		-keystore "$KS" \
		-alias xadrez3d \
		-keyalg RSA -keysize 2048 -validity 10000 \
		-storepass "$KS_PASS_IN" -keypass "$KS_PASS_IN" \
		-dname "CN=Levy, OU=Dev, O=LevyDev, L=Brasilia, ST=DF, C=BR"
	chmod 600 "$KS"
	ok "release keystore em $KS"
else
	ok "release keystore ja existe"
fi

# ------------------------------------------------------------------ fim ----
step "config do editor"
mkdir -p "$HOME/.config/godot"
CFG="$HOME/.config/godot/editor_settings-4.tres"
for kv in \
	"android/android_sdk_path=\"$SDK\"" \
	"android/debug_keystore=\"$HOME/.android/debug.keystore\"" \
	"android/debug_keystore_user=\"androiddebugkey\"" \
	"android/debug_keystore_pass=\"android\"" ; do
	key="${kv%%=*}"
	if ! grep -q "^$key" "$CFG" 2>/dev/null; then
		if ! grep -q '^\[export\]' "$CFG" 2>/dev/null; then
			printf '\n[export]\n' >> "$CFG"
		fi
		# insere logo depois de [export]
		awk -v ins="$kv" '/^\[export\]/{print; print ins; next} {print}' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
	fi
done
ok "editor_settings-4.tres"

cat <<EOF

────────────────────────────────────────────────────────────
 pronto. Para gerar o APK:

   cd $(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
   export KS_PASS='sua-senha'
   ./tools/build_android.sh release

 sai em: ~/dev/build/xadrez3d-v1.0.0-<data>.apk
 copia:  C:\\Users\\<voce>\\Downloads\\xadrez3d-final.apk
────────────────────────────────────────────────────────────
EOF
