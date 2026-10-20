# Release Android — Xadrez 3D

## 1. Keystore de produção (criar UMA vez, guardar para sempre)

```bash
mkdir -p ~/keystores && chmod 700 ~/keystores

keytool -genkey -v \
  -keystore ~/keystores/xadrez3d-release.keystore \
  -alias xadrez3d \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$KS_PASS" -keypass "$KS_PASS" \
  -dname "CN=Levy, OU=Dev, O=LevyDev, L=Brasilia, ST=DF, C=BR"

chmod 600 ~/keystores/xadrez3d-release.keystore
keytool -list -v -keystore ~/keystores/xadrez3d-release.keystore -alias xadrez3d
```

**Regras:**
- A senha da keystore e da chave são a mesma (o script usa `env:KS_PASS` nos dois).
- Guardar a senha num gerenciador. Sem ela, não há update possível sem desinstalar.
- Nunca commitar `*.keystore`. Já está no `.gitignore`.
- Validade 10000 dias (~27 anos). Play Store exige validade até 2033 ou mais.

## 2. export_presets.cfg — setup manual (NÃO versionar)

O arquivo guarda usuário/senha da keystore, por isso está no `.gitignore`.
Criar uma vez pelo editor:

```
Projeto > Exportar > Adicionar > Android

  Unique Name ........ com.levy.xadrez3d
  Name ............... Xadrez 3D
  Version Code ....... 1
  Version Name ....... 1.0.0
  Orientação ......... Landscape
  Immersive Mode ..... On
  Arquiteturas ....... apenas arm64-v8a
  Signed ............. OFF   (assinatura fica com apksigner no script)
  gradle_build/use_gradle_build ...... false
```

Permissões: deixar **todas** desmarcadas e `Custom Permissions` vazio.
Um jogo de xadrez offline não precisa de nenhuma.

Chaves do preset (referência para recriar sem o editor):

```ini
package/unique_name="com.levy.xadrez3d"
package/name="Xadrez 3D"
package/signed=false
package/app_category=2
package/show_launcher_icon=true
version/code=1
version/name="1.0.0"
gradle_build/use_gradle_build=false
architectures/armeabi-v7a=false
architectures/arm64-v8a=true
architectures/x86=false
architectures/x86_64=false
permissions/custom_permissions=PackedStringArray()
permissions/internet=false
permissions/access_network_state=false
permissions/access_wifi_state=false
permissions/change_network_state=false
permissions/change_wifi_state=false
permissions/vibrate=false
permissions/wake_lock=false
permissions/read_external_storage=false
permissions/write_external_storage=false
permissions/manage_external_storage=false
permissions/read_phone_state=false
permissions/call_phone=false
permissions/process_outgoing_calls=false
permissions/answer_phone_calls=false
permissions/read_call_log=false
permissions/write_call_log=false
permissions/read_sms=false
permissions/send_sms=false
permissions/receive_sms=false
permissions/receive_mms=false
permissions/receive_wap_push=false
permissions/read_contacts=false
permissions/write_contacts=false
permissions/read_calendar=false
permissions/write_calendar=false
permissions/record_audio=false
permissions/modify_audio_settings=false
permissions/camera=false
permissions/access_fine_location=false
permissions/access_coarse_location=false
permissions/access_mock_location=false
permissions/access_background_location=false
permissions/body_sensors=false
permissions/bluetooth=false
permissions/bluetooth_admin=false
permissions/bluetooth_scan=false
permissions/bluetooth_connect=false
permissions/bluetooth_advertise=false
permissions/nfc=false
permissions/foreground_service=false
permissions/post_notifications=false
permissions/system_alert_window=false
permissions/request_install_packages=false
permissions/request_delete_packages=false
permissions/install_packages=false
permissions/delete_packages=false
permissions/query_all_packages=false
permissions/get_accounts=false
permissions/get_tasks=false
permissions/reorder_tasks=false
permissions/kill_background_processes=false
permissions/restart_packages=false
permissions/persistent_activity=false
permissions/set_alarm=false
permissions/set_time=false
permissions/set_time_zone=false
permissions/set_wallpaper=false
permissions/expand_status_bar=false
permissions/status_bar=false
permissions/disable_keyguard=false
permissions/write_settings=false
permissions/write_secure_settings=false
permissions/write_gservices=false
permissions/write_sync_settings=false
permissions/read_sync_settings=false
permissions/use_biometric=false
permissions/use_fingerprint=false
permissions/use_sip=false
permissions/add_voicemail=false
permissions/battery_stats=false
permissions/dump=false
permissions/diagnostic=false
permissions/factory_test=false
permissions/reboot=false
permissions/receive_boot_completed=false
permissions/broadcast_package_removed=false
permissions/clear_app_cache=false
permissions/delete_cache_files=false
permissions/get_package_size=false
permissions/update_device_stats=false
permissions/mount_unmount_filesystems=false
permissions/mount_format_filesystems=false
permissions/master_clear=false
permissions/request_ignore_battery_optimizations=false
permissions/transmit_ir=false
permissions/install_shortcut=false
permissions/uninstall_shortcut=false
```

> A lista completa do Godot tem ~130 chaves. As acima cobrem todas as
> permissões perigosas (`dangerous`) que disparam o Play Protect.
> Depois do build, confirme com `aapt2 dump badging <apk> | grep uses-permission`.

## 3. Build

```bash
chmod +x tools/build_android.sh
export KS_PASS='sua-senha-aqui'
./tools/build_android.sh release
```

Saída: `~/dev/build/xadrez3d-v1.0.0-<data>.apk`
Cópia: `C:\Users\<usuario>\Downloads\xadrez3d-final.apk`

## 4. Sobre o aviso do Play Protect

Ser honesto aqui: **o aviso não desaparece só por assinar.**

- O aviso "instalado de fonte desconhecida" aparece porque o APK foi
  sideloaded, não porque não está assinado. Todo sideload mostra.
- O que reduz a chance do Play Protect classificar como risco:
  1. Assinatura com chave própria (não a `debug.keystore`) — feito.
  2. Zero permissões perigosas no manifest — feito.
  3. `targetSdkVersion` recente. Com `use_gradle_build=false`, o Godot usa o
     target do template dele. Para publicar na Play Store isso vai precisar
     de gradle build com `targetSdk` 34+. Para sideload, tranquilo.
  4. Manter a MESMA chave em todas as versões — mudar obriga a desinstalar.
- Nunca peça `QUERY_ALL_PACKAGES`, `MANAGE_EXTERNAL_STORAGE`,
  `REQUEST_INSTALL_PACKAGES`, SMS ou `CALL_LOG`. São os maiores gatilhos.

## 5. Checklist antes de distribuir

- [ ] `aapt2 dump badging` não lista nenhuma permissão
- [ ] `apksigner verify` retorna "Verifies"
- [ ] `architectures`: só arm64-v8a
- [ ] Testado em um device real (não só no emulador do PC)
- [ ] Keystore backupada em local seguro (não só no WSL)
