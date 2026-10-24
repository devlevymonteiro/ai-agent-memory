# BRASA — O Véu do Esquecimento

Um jogo de teste 2D em pixel art para **Android (.APK)**, feito para rodar
100% offline numa WebView. Estilo Zelda de Game Boy, mas com identidade própria:
você é a última brasa num mundo que esqueceu de si — sua **luz** revela o
caminho e cada **lembrança** recuperada faz a chama (e a visão) crescer.

- **3 cores exatas** (veja [`PALETTE.md`](PALETTE.md)) + dithering para a luz.
- **Música** chiptune gerativa (Web Audio) e **efeitos sonoros**, ambos com
  volume **ajustável** nas Opções.
- **Save** automático (posição, lembranças coletadas, tempo, volumes) via
  `SharedPreferences` — com botão **Continuar** na tela de entrada.
- **Tela de entrada** (título), **pausa**, **opções** e **final**.
- **Sem seleção de fases**: um único mapa contínuo gerado de forma determinística.
- Controles na tela (D-pad + investida) e por teclado.

---

## Baixar e instalar

O APK já vem pronto na raiz: **[`BRASA.apk`](BRASA.apk)** (~30 KB).

1. Copie `BRASA.apk` para o celular.
2. Abra o arquivo no gerenciador de arquivos.
3. Se o Android pedir, autorize **"Instalar de fontes desconhecidas"** para o
   app de arquivos.
4. Toque em **Instalar** e abra.

Requisitos: **Android 5.0 (API 21) ou superior**. O app não pede nenhuma
permissão (nem internet) e funciona totalmente offline.

> É um APK de **teste/demonstração**, assinado com chave de desenvolvimento.
> Não está publicado na Play Store.

---

## Como jogar

- **Objetivo:** encontre as **8 lembranças** espalhadas pelo mapa.
- **Luz:** sua brasa ilumina apenas ao redor. Áreas já visitadas ficam na
  "memória" (visíveis de forma tênue); o resto permanece no escuro.
- **Cada lembrança coletada aumenta o raio da sua luz** — o mundo "se lembra"
  à medida que você avança.
- **Tochas** nas paredes são pontos de luz fixos: use-as como referência.
- **Santuários** (braseiros maiores) salvam seu progresso e servem de retorno.
- **Sombras** vagam pelo mapa: se uma alcançar você, você volta ao último
  santuário. A **investida** (dash) serve para escapar e dá um clarão de luz.
- Toque no botão **⏸** (canto superior direito) para pausar. No celular, o botão
  **Voltar** do Android também abre/fecha a pausa.

### Controles

| Ação | Toque (Android) | Teclado (navegador) |
|------|-----------------|---------------------|
| Mover | D-pad (canto inferior esquerdo) | Setas ou WASD |
| Investida | Botão circular (canto inferior direito) | Shift / J / Z |
| Pausa | Botão ⏸ (canto superior direito) | Esc / P |
| Confirmar em menus | Toque no botão | Enter / Espaço |
| Navegar em menus | Toque | Setas ↑↓ / ←→ (ajusta volume) |

---

## Estrutura do projeto

```
BRASA.apk                      # APK final assinado (entregável)
game/index.html                # O jogo inteiro (HTML+CSS+JS, 3 cores)
android/
  AndroidManifest.xml         # pacote com.brasa.veu, minSdk 21, targetSdk 28
  src/com/brasa/veu/MainActivity.java   # casca WebView + ponte de save
  res/                        # ícones de launcher + strings
  build.sh                    # compila DEX, recursos e assina o APK
tools/
  setup-toolchain.sh          # baixa o toolchain Android via npm (sem SDK do Google)
  make_icons.py               # gera os ícones pixel art em PNG puro
PALETTE.md                     # pesquisa de cor (Game Boy/Lospec → Adobe Color)
```

### Como o APK é construído (sem Android Studio / Gradle / SDK do Google)

O sandbox só tem acesso ao registro npm e ao PyPI — sem `dl.google.com`. Então o
toolchain é montado a partir de pacotes npm que já embutem as ferramentas:

| Ferramenta | Origem |
|-----------|--------|
| `aapt2` (nativo Linux) | npm `aaptjs3` |
| JRE 17 | npm `javajre-linux-64` |
| `android.jar`, `d8.jar`, `apksigner.jar`, `ecj.jar` | npm `@drxiaozhi/minapk` |

```bash
bash tools/setup-toolchain.sh     # uso: baixa e monta tools/.toolchain (não versionado)
bash android/build.sh             # gera BRASA.apk na raiz
```

O `build.sh`:
1. `aapt2 compile` + `link` → `resources.apk` (manifest binário, recursos, assets).
2. `ecj` compila o `MainActivity.java` contra `android.jar`.
3. `d8/R8` gera `classes.dex`.
4. `zip` junta o DEX ao `resources.apk`.
5. `openssl` cria a chave e o `apksigner` assina em **v1 (JAR) + v2**.

A assinatura é verificada no fim do build. `tools/.toolchain/`,
`android/.build/` e a chave de assinatura estão no `.gitignore`.

---

## Validado

- `apksigner verify`: **v1 = true, v2 = true**.
- Testes automatizados com Chromium headless: tela de entrada, início de jogo,
  movimento (toque e teclado), investida, pausa, opções/volume, coleta das 8
  lembranças → vitória, **save persistindo entre "reaberturas"** do app, e
  carregamento via `file://` com a ponte nativa `BrasaStore` — **zero erros** de JS.
- Custo de render ~4 ms/frame a 196×360 (folga para 60 fps mesmo em celulares modestos).

---

*Projeto de demonstração independente. Sem vínculo com Nintendo, Meta ou Adobe.*
