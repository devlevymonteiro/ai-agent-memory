#!/usr/bin/env python3
"""Gera os icones de launcher em PNG puro (sem dependencias externas).
Desenha uma tocha/lanterna de pixel art usando APENAS as 3 cores do jogo.
"""
import struct, zlib, os

# Paleta do jogo (RGB)
DARK  = (0x12, 0x0b, 0x17)
MID   = (0x8c, 0x3b, 0x5a)
LIGHT = (0xf2, 0xc6, 0x6d)
PAL = [DARK, MID, LIGHT]

N = 24
g = [[0] * N for _ in range(N)]

def px(x, y, c):
    if 0 <= x < N and 0 <= y < N:
        g[y][x] = c

def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(x, y, c)

# --- moldura arredondada (mid) ---
for x in range(2, 22):
    px(x, 1, 1); px(x, 22, 1)
for y in range(2, 22):
    px(1, y, 1); px(22, y, 1)
for (x, y) in [(1,1),(22,1),(1,22),(22,22),(2,1),(21,1),(2,22),(21,22),
               (1,2),(1,21),(22,2),(22,21)]:
    px(x, y, 0)

# --- alcanca (handle) no topo ---
px(11, 2, 1); px(12, 2, 1)
px(10, 3, 1); px(13, 3, 1)
px(10, 4, 1); px(13, 4, 1)

# --- corpo da lanterna: contorno mid, interior dark ---
rect(7, 5, 16, 6, 1)          # tampa superior
rect(7, 18, 16, 19, 1)        # base
for y in range(7, 18):
    px(7, y, 1); px(16, y, 1) # laterais de vidro
# detalhes da base
rect(6, 19, 17, 20, 1)
px(6, 21, 1); px(17, 21, 1)

# --- chama (light), formato de gota apontando para cima ---
flame = [
    (8,  [11, 12]),
    (9,  [11, 12]),
    (10, [10, 11, 12, 13]),
    (11, [10, 11, 12, 13]),
    (12, [9, 10, 11, 12, 13, 14]),
    (13, [9, 10, 11, 12, 13, 14]),
    (14, [10, 11, 12, 13]),
    (15, [11, 12]),
]
for y, xs in flame:
    for x in xs:
        px(x, y, 2)
# miolo mais claro (ainda light) e brilho
px(11, 11, 2); px(12, 11, 2)

# --- fagulhas / lembrancas ao redor (light) ---
px(4, 9, 2); px(19, 7, 2); px(18, 14, 2); px(5, 15, 2)


def write_png(path, grid, scale):
    h = len(grid) * scale
    w = len(grid[0]) * scale
    # monta scanlines RGBA (alpha 255)
    raw = bytearray()
    for row in grid:
        line = bytearray()
        for c in row:
            r, gg, b = PAL[c]
            line += bytes((r, gg, b, 255)) * scale
        for _ in range(scale):
            raw += b'\x00' + line  # filtro 0 (None) por scanline

    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        c += struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
        return c

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)  # RGBA 8-bit
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', ihdr)
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return w, h

BASE = os.path.join(os.path.dirname(__file__), '..', 'android', 'res')
sizes = {
    'mipmap-mdpi': 2,
    'mipmap-hdpi': 3,
    'mipmap-xhdpi': 4,
    'mipmap-xxhdpi': 6,
    'mipmap-xxxhdpi': 8,
}
for folder, sc in sizes.items():
    p = os.path.join(BASE, folder, 'ic_launcher.png')
    w, h = write_png(p, g, sc)
    print(f'{folder}/ic_launcher.png  {w}x{h}')

# salva uma versao maior so para conferencia visual
write_png(os.path.join(os.path.dirname(__file__), 'icon_preview.png'), g, 12)
print('icon_preview.png (conferencia)')
