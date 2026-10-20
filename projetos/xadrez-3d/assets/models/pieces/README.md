# Peças — assets 3D

Jogue os arquivos `.glb` aqui. O `PieceModelLoader` varre esta pasta em runtime:
não é obrigatório renomear nada, ele casa por palavra-chave no nome do arquivo.

## Nomenclatura reconhecida

| Peça | Palavras-chave aceitas |
|---|---|
| pawn | `pawn`, `peao`, `peon`, `bauer`, `soldier` |
| knight | `knight`, `horse`, `cavalo`, `springer` |
| bishop | `bishop`, `bispo`, `laeufer` |
| rook | `rook`, `castle`, `torre`, `turm` |
| queen | `queen`, `rainha`, `dame` |
| king | `king`, `rei`, `konig` |

Cor (opcional): `white`/`light`/`clara` ou `black`/`dark`/`preta` em qualquer
posição do nome. Exemplos válidos:

```
pawn.glb            -> neutro, tingido por material (branco/preto)
pawn_white.glb      -> pack com cor separada
black_knight.glb    -> idem
King_Light.glb      -> idem
chess_pieces.glb    -> arquivo único: extrai o nó filho por palavra-chave
```

Prioridade: arquivo por cor → neutro → sub-cena de arquivo combinado → fallback procedural.

## Fontes CC0 verificadas (2026-10)

| Fonte | Licença | Formato | Nota |
|---|---|---|---|
| https://polyyai.itch.io/3d-chess-pieces-pack | CC0 | GLB + PBR | 12 peças Staunton (clara/escura) + versão low-poly 3.6k–4.6k tris. **Melhor para mobile.** |
| https://polyyai.itch.io/3d-chess-sets-pack-1 | CC0 | GLB + PBR | 48 peças, 4 conjuntos |
| https://opengameart.org/content/3d-chess-pieces | CC0 | glTF + .blend | 264 KB, super leve, conjunto único (neutro) |
| https://ithappystudios.com/free/chess-pack-free/ | CC0 | GLB/FBX/OBJ | 53 assets, 73K tris no pack inteiro |
| https://polyhaven.com/a/chess_set | CC0 | glTF + 4K PBR | 77K tris — pesado, precisa decimar pra mobile |
| https://ejgarner118.itch.io/chess-set | livre | .blend + FBX | 32 peças + tabuleiro, 3.7 MB |

**Kenney não tem Chess Kit** (confirmado na busca do catálogo: kenney.nl/assets?search=chess).

## Atenção com licença

Sempre confira a licença na página no momento do download — a lista acima foi
verificada em 2026-10-20, mas packs em itch.io podem mudar de licença.
