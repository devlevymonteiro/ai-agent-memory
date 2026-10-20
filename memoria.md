# MEMÓRIA DE LONGO PRAZO — memoria.md

> Última atualização: 2026-10-20 · Ciclo 006

## 1. Identidade do Usuário

- **Nome correto: Levy** (grafia com **Y** no final — NUNCA "Levi").
  - Regra absoluta. Aplicar em saudações, comentários de código, nomes de branches, mensagens de commit e qualquer texto gerado.

## 2. Diretrizes Gerais de Resposta

- Estilo: direto, focado em engenharia, sem explicações óbvias.
- Código: solução limpa, estruturada, pronta para colar e rodar.
- Comandos de terminal: prontos para execução, sem rodeios.
- Ao final de cada tarefa ou correção: **sempre** gerar o bloco atualizado deste arquivo (e de `skills.md` quando aplicável).
- Idioma das respostas: português (BR). Código e comentários: inglês.

## 3. Projeto Ativo

- **Nome:** Xadrez 3D
- **Plataforma alvo:** Android (`.apk`)
- **Ambiente de build:** WSL/Linux
- **Engine decidida:** Godot 4.x (GDScript) — exportação nativa para Android
- **Stack descartada neste projeto:** Three.js / React Three Fiber + Capacitor

### 3.1 Diretrizes de Desenvolvimento (Xadrez 3D)

- **Renderizador:** `mobile`.
- **Orientação:** landscape travado.
- **Input:** eventos de toque (`InputEventScreenTouch`) + raycast. Nenhuma lógica presa ao mouse.
- **Coordenadas do tabuleiro:** X/Z no plano do mundo, Y para cima, origem no centro do tabuleiro. `coord = Vector2i(file, rank)` com file 0..7 → a..h e rank 0..7 → 8..1.
- **Workspace WSL:** projeto sempre em `~/` (ext4). Nunca em `/mnt/c` (IO do NTFS degrada o build).
- **Performance mobile é requisito, não otimização tardia:** alvo de 60 FPS em dispositivos intermediários.
- **Código modular:** um script por sistema, com `class_name` (tabuleiro, peças, input, IA, UI). Nenhum script faz-tudo.
- **Assets 3D:** `.glb` (preferido) ou `.gltf`. Nada de formato proprietário.
- **Estratégia de assets: pacotes prontos CC0 primeiro, gerar com IA só se faltar.** Não modelar do zero o que já existe liberado.
- **Fallback procedural obrigatório:** nenhum sistema pode quebrar porque um `.glb` ainda não foi baixado.

### 3.2 Decisões de Assets (Ciclo 002)

- **Fonte preferida:** packs CC0 prontos e otimizados, em `.glb`, com versão low-poly.
- **Kenney NÃO tem Chess Kit** — verificado no catálogo (kenney.nl/assets?search=chess). Não sugerir.
- **Loader tolerante a nomenclatura:** casamento por palavra-chave + varredura de pasta, nunca depender de renomear arquivos do pack.
- **Normalização em runtime:** escala por altura-alvo do tipo, origem centralizada em X/Z, base assentada em Y=0.
- **Materiais compartilhados:** 4 no total (branco/preto × normal/destacado). Pack que já vem em madeira clara/escura mantém o PBR original.
- **Peças pretas rotacionadas 180° em Y**, com a rotação no nó do modelo (não no nó da peça) para não conflitar com Tweens de posição.

### 3.3 Decisões de Lógica de Jogo (Ciclo 003)

- **Separação de responsabilidades fixa:** `board.gd` orquestra (input, animação, estado visual) · `chess_rules.gd` valida (puro, sem tocar em nós) · `turn_manager.gd` controla a vez e o histórico.
- **Estado lógico antes da animação:** o dicionário `pieces` é atualizado antes de qualquer Tween. Nunca o inverso.
- **Input travado durante a animação** (`is_animating`); a vez só passa quando a animação termina. Evita jogada dupla por toque rápido.
- **Captura destacada em vermelho, destino livre em verde, peça selecionada em amarelo** — feedback visual antes de confirmar.
- **Rotação de 180° das pretas fica no nó do modelo**, nunca no nó da peça (conflitaria com Tween de posição).
- **Clicar na peça inimiga que é alvo válido executa a captura** — não obriga acertar a casa atrás dela.
- **Escopo do validador (ciclo 003):** geometria das 6 peças, bloqueio, captura, avanço duplo do peão. Fora: en passant, roque, promoção, xeque, xeque-mate.

### 3.4 Regras Completas e Build (Ciclo 004)

- **Duas camadas de validação, sempre:** `valid_moves()` = geometria pura (pseudo-legal); `legal_moves()` = pseudo-legal filtrado por "não deixa meu rei em xeque". **A UI só consome `legal_moves()`.**
- **Detecção de ataque por geometria direta** (`is_square_attacked`), não por enumeração de movimentos — `legal_moves()` a chama dezenas de vezes por jogada.
- **Promoção automática em Rainha** por padrão (`PROMOTION_AUTO_QUEEN`). `promotion_options()` é o ponto de extensão para a UI de escolha.
- **Promoção acontece depois da animação e antes da troca de turno** — a peça nova altera a avaliação de xeque.
- **Fim de jogo detectado após cada jogada** (`ChessRules.status()`): xeque-mate e afogamento travam o input via `is_game_over`.
- **Build:** `tools/build_android.sh` — export headless + cópia automática para `/mnt/c/Users/<usuario>/Downloads/`. APK nunca é versionado.
- **CORREÇÃO (ver 5.003): `export_presets.cfg` NÃO deve ser versionado** — guarda usuário/senha da keystore. Setup manual em `tools/RELEASE.md`.

### 3.5 Release e Otimização Mobile (Ciclo 005)

- **Renderer `mobile`; VRAM compression ETC2/ASTC obrigatória** (sem isso a RAM do Android estoura com texturas 4K dos `.glb`).
- **Sombra direcional: atlas 1024, PSSM2 (`directional_shadow_mode = 1`), `blend_splits = false`, `max_distance = 24`.**
- **SSAO, SSIL, SDFGI, Glow, Fog e Volumetric Fog desligados no `Environment`** (não são project settings — vivem no recurso do `WorldEnvironment`).
- **VSync ligado + `run/max_fps = 60`** para travar o consumo em telas de 120 Hz.
- **Guarda definitiva contra lance ilegal:** `execute_move()` revalida com `ChessRules.legal_moves()`, não com o cache de destaque. IA/replay/undo não conseguem burlar.
- **Promoção automática para Rainha** (`PROMOTION_AUTO_QUEEN = true`) — sem UI de escolha no celular.
- **Assinatura fora do Godot:** preset com `package/signed=false` -> `zipalign` -> `apksigner` com senha via `env:KS_PASS`. Senha nunca toca o disco do repo.
- **Zero permissões no manifest** (`permissions/custom_permissions=PackedStringArray()`, todas as toggles false).
- **Play Protect:** assinar NAO remove o aviso de sideload. O que ajuda: chave própria, zero permissões perigosas, targetSdk recente, mesma chave para sempre.

### 3.6 Ambiente de Execução do Agente (Ciclo 006)

- **O agente NAO consegue gerar o APK.** Rede restrita: `dl.google.com` (Android SDK) e `release-assets.githubusercontent.com` (binarios do Godot) sao bloqueados. So `github.com`, `api.github.com`, `codeload.github.com`, `npmjs`, `pypi` sao liberados.
- **Consequencia pratica:** o agente NAO deve prometer entregar `.apk`. O build acontece na maquina do Levy, via `tools/setup_toolchain.sh` + `tools/build_android.sh`.
- **O que o agente PODE fazer no sandbox:** auditoria estatica de integracao (referencias cruzadas entre scripts, sinais, assinaturas), geracao de `export_presets.cfg`, escrita dos scripts de build.
- **`export_presets.cfg` pode ser escrito a mao** e foi commitado (sem senha, pois `package/signed=false`). Isso elimina a necessidade da GUI do editor no WSL.

## 4. Preferências Técnicas Registradas

| Contexto | Preferência |
|---|---|
| Export Android | Godot 4 nativo (sem WebView/Capacitor) |
| Formato de asset 3D | `.glb` / `.gltf` — packs CC0 prontos; IA generativa só se o pack não cobrir |
| Estrutura de projeto | `scripts/`, `scenes/`, `assets/` separados |
| Raycast de input | `PhysicsDirectSpaceState3D.intersect_ray()` em `_physics_process()`, máscara `squares \| pieces` |
| Câmera | fit automático por aspect ratio no `_ready()` + `size_changed` |
| Draw calls | recursos de mesh/shape/material compartilhados entre instâncias |
| Animação de jogada | `Tween` de 0.22 s; captura encolhe + sobe em 0.18 s e dá `queue_free()` |
| Build Android | `tools/build_android.sh release` → export headless + `zipalign` + `apksigner` + `cp` para `/mnt/c/Users/<user>/Downloads/xadrez3d-final.apk` |
| Assinatura | keystore própria em `~/keystores/xadrez3d-release.keystore`; senha via `env:KS_PASS`; nunca no git |
| Setup do toolchain | `tools/setup_toolchain.sh` (idempotente) — Godot + templates + Android SDK + keystores + editor_settings |
| Assets de peças | `.glb` CC0 de packs prontos, low-poly; carregador com fallback procedural |

## 5. Correções Aprendidas

| # | Erro cometido | Regra gerada |
|---|---|---|
| 001 | Escrevi "Levi" | O nome é **Levy**, com Y. Verificar antes de qualquer saudação ou texto. |
| 002 | Pressumi que existia "Chess Kit do Kenney" | Verificar a existência do asset antes de indicar. Kenney não tem pack de xadrez. |
| 003 | No ciclo 004 mandei versionar `export_presets.cfg` | Arquivo guarda senha da keystore de release. Vai no `.gitignore`; setup manual em `tools/RELEASE.md`. |

## 6. Histórico de Ciclos

- **Ciclo 001 (2026-10-20):** Definição do projeto Xadrez 3D para Android. Escolha da stack (Godot 4 sobre R3F+Capacitor). Setup de toolchain WSL (Godot + Android SDK + debug keystore). Criação da cena 3D com tabuleiro 8x8 procedural, cores alternadas, coordenadas de mundo X/Z e detecção de toque por raycast.
- **Ciclo 002 (2026-10-20):** Decisão de usar packs 3D prontos CC0 em vez de gerar peças com IA. Lista de fontes verificadas. `scripts/piece_model_loader.gd` (varredura de pasta por palavra-chave, normalização de escala/origem, materiais compartilhados, fallback procedural). `scripts/piece.gd` integrada ao loader, com peças pretas rotacionadas 180° em Y.
- **Ciclo 003 (2026-10-20):** Jogo jogável. `scripts/chess_rules.gd` (validação por tipo, deslizantes com bloqueio, peão com avanço duplo e captura diagonal). `scripts/turn_manager.gd` (vez, histórico, notação de debug). `scripts/board.gd` reescrito: seleção de peça do turno, destaque de destinos/capturas, movimento com Tween, captura com animação de saída e troca de turno. `scripts/square.gd` com enum de destaque (nenhum/selecionada/movimento/captura).
- **Ciclo 004 (2026-10-20):** Regras completas e build. `chess_rules.gd` com xeque, xeque-mate, afogamento (via `legal_moves()` filtrando movimentos que expõem o rei) e promoção de peão. `piece.gd` com `set_type()` (reconstrói modelo + volume de pick sem recriar o nó). `board.gd` com `legal_moves()`, promoção pós-animação, sinais de xeque/fim de jogo e `reset_game()`. `tools/build_android.sh` para build headless + cópia para o Windows.
- **Ciclo 005 (2026-10-20):** Release. `project.godot` com renderer mobile, VRAM ETC2/ASTC, atlas de sombra 1024, PSSM2, `run/max_fps=60`. `main.tscn` com Environment sem SSAO/SSIL/SDFGI/Glow/Fog e luzes com shadow bias ajustado. `board.gd` com guarda definitiva de lance ilegal em `execute_move()`. `turn_manager.gd` com `is_finished`/`finish()`. `tools/build_android.sh` com fluxo completo de assinatura (export unsigned -> zipalign -> apksigner -> Downloads). `tools/RELEASE.md` com keystore, permissões e a verdade sobre Play Protect.
- **Ciclo 006 (2026-10-20):** Toolchain de um comando. Confirmado que o agente NAO pode compilar (SDK do Google e assets do GitHub bloqueados). Auditoria estatica de integracao entre os 7 scripts (84 checagens, 0 problemas). `export_presets.cfg` gerado (88 permissoes desativadas, `package/signed=false`). `tools/setup_toolchain.sh` idempotente para instalar tudo do zero.
