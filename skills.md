# SKILLS — skills.md

> Procedimentos salvos para reutilização. Criado em 2026-10-20.

---

## SKILL-001 · Toolchain Godot 4 → APK Android no WSL

**Quando usar:** configurar ou reconstruir o ambiente de build de qualquer projeto Godot 4 Android em WSL/Linux.

### Passo a passo

1. **Workspace em ext4.** `mkdir -p ~/dev/<projeto>`. Nunca em `/mnt/c`.
2. **Dependências base:**
   ```bash
   sudo apt update && sudo apt install -y unzip zip curl wget openjdk-17-jdk
   ```
3. **Godot (sempre a última stable):**
   ```bash
   GODOT_VERSION=$(curl -s https://api.github.com/repos/godotengine/godot/releases/latest | grep -oP '"tag_name": "\K[^"]+')
   curl -LO "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.x86_64.zip"
   unzip -o "Godot_v${GODOT_VERSION}_linux.x86_64.zip" -d ~/tools/godot
   mv ~/tools/godot/Godot_v${GODOT_VERSION}_linux.x86_64 ~/tools/godot/godot && chmod +x ~/tools/godot/godot
   ```
4. **Export templates** (obrigatório para gerar APK):
   ```bash
   SEMVER=$(~/tools/godot/godot --headless --version)   # ex: 4.3.stable
   curl -LO "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_export_templates.tpz"
   mkdir -p ~/.local/share/godot/export_templates
   unzip -q "Godot_v${GODOT_VERSION}_export_templates.tpz" -d /tmp/godot_tpl
   mv /tmp/godot_tpl/templates ~/.local/share/godot/export_templates/${SEMVER}
   ```
5. **Android SDK (sem Android Studio):**
   ```bash
   mkdir -p ~/Android/Sdk/cmdline-tools
   curl -Lo /tmp/cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
   unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools && mv /tmp/cmdtools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest
   yes | ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=$HOME/Android/Sdk --licenses
   ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=$HOME/Android/Sdk \
     "platform-tools" "build-tools;35.0.0" "platforms;android-35"
   ```
   Godot 4 **não** precisa do NDK (só se usar GDExtension em C++).
6. **Debug keystore:**
   ```bash
   mkdir -p ~/.android
   keytool -keyalg RSA -genkeypair -alias androiddebugkey -keypass android -storepass android \
     -dname "CN=Android Debug,O=Android,C=US" -validity 9999 -keystore ~/.android/debug.keystore
   ```
7. **Apontar caminhos em `~/.config/godot/editor_settings-4.tres`:**
   ```ini
   [export]
   android/android_sdk_path="/home/<usuario>/Android/Sdk"
   android/debug_keystore="/home/<usuario>/.android/debug.keystore"
   android/debug_keystore_user="androiddebugkey"
   android/debug_keystore_pass="android"
   ```
8. **Criar o preset Android** uma única vez pelo editor (`Projeto > Exportar > Adicionar > Android`) ou colar um `export_presets.cfg` mínimo. Usar `gradle_build/use_gradle_build=false` (build nativo do Godot, sem download do Gradle).
9. **Exportar headless:**
   ```bash
   ~/tools/godot/godot --headless --export-release "Android" ../build/xadrez3d.apk
   ```

### Armadilhas conhecidas

- Caminhos absolutos: Godot não expande `~` em `editor_settings`. Usar `/home/<usuario>/...`.
- `adb` no WSL não enxerga USB. Instalar o APK por uma destas rotas:
  - Copiar para o Windows: `cp build/app.apk /mnt/c/Users/<usuario>/Downloads/`
  - **adb via TCP (recomendado):** do PowerShell do Windows, `adb tcpip 5555`; do WSL, `~/Android/Sdk/platform-tools/adb connect <ip-do-celular>:5555 && adb install -r build/app.apk`.
- Fechar o editor antes de exportar headless na mesma pasta (lock do `.godot/`).

---

## SKILL-002 · Input por raycast em Godot 4 (toque → objeto 3D)

**Quando usar:** qualquer seleção por toque/clique em cena 3D.

1. Coloque os alvos em uma camada de física dedicada (`collision_layer = 1`, nomeada em `Projeto > Configurações > Nomes de Camadas 3D`).
2. Capture o toque em `_unhandled_input`, diferenciando toque de arrasto por distância em pixels (`TAP_MAX_DRAG`).
3. **Não** execute `intersect_ray()` dentro do handler de input. Guarde o ponto e resolva em `_physics_process()` — o espaço de física pode estar travado fora dele.
4. Máscara de colisão explícita (`query.collision_mask`) para o raycast não atravessar peças/UI.
5. Chame `get_viewport().set_input_as_handled()` ao consumir o evento.
6. Alternativa sem física para superfícies planas: `Plane.intersects_ray()` + conversão da coordenada de mundo em índice — O(1) e mais barato, mas não funciona com peças de alturas diferentes.
