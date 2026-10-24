# Pesquisa de cor — BRASA

> O pedido foi "no máximo umas 3 cores" e para pesquisar a cor **antes** de
> recorrer ao Adobe Color. Abaixo está o caminho percorrido, em ordem.

## 1. Antes do Adobe Color — o que os consoles e a comunidade usam

Primeiro olhei as referências de paleta fixa (a "escola" do pixel art de poucas cores):

- **Game Boy (DMG, 1989):** 4 tons de verde — `#0F380F`, `#306230`, `#8BAC0F`,
  `#9BBC0F`. É a restrição mais famosa do pixel art e a referência de clima que o
  jogo pede ("estilo Zelda do Game Boy"). [5](https://pixelsynth.art/palettes/game-boy)
- **Lospec Palette List:** banco com milhares de paletas curadas filtráveis por
  quantidade de cores — de onde saem variações "GB" como *Mist GB*, *Crimson*,
  etc. [1](https://lospec.com/palette-list/tag/gameboy) · [17](https://lospec.com/)
- **Downwell:** usa uma paleta **estrita de 3 cores** que muda a cada partida;
  prova que 3 cores bastam para uma identidade visual fortíssima.
  [20](https://soulbound.game/blog/best-pixel-art-games-on-steam-you-need-to-play-in-2026)
- **Dithering (tramado):** com poucas cores, usa-se um padrão (Bayer 4×4) para
  "misturar" dois tons e criar degradês sem adicionar uma 4ª cor. É a técnica
  usada no passe de luz/lanterna do jogo. [6](https://imgscale.net/pixellab/blog/retro-palette-guide)

**Conclusão da etapa 1:** manter 3 cores + dithering dá o visual retrô autêntico
sem cair no verde óbvio do Game Boy (justamente para "fugir do genérico").

## 2. Adobe Color — harmonia e clima

Depois validei a escolha pelas regras de harmonia do Adobe Color:

- **Harmonia análoga / triádica** no Color Wheel gera combinações equilibradas;
  o próprio material do Adobe indica a **análoga** para temas "moody,
  atmospheric". [2](https://www.adorama.com/alc/adobe-color-wheel/) ·
  [7](https://www.designyourway.net/blog/three-color-palettes/)
- **"Moody & gothic" (Adobe Express):** caça-verde, azul-marinho, **ameixa**,
  **rosa empoeirado** e **joias profundas com carvão**.
  [1](https://www.adobe.com/express/learn/blog/101-brilliant-color-combinations) ·
  [9](https://www.creativebloq.com/news/adobe-colour-combinations)
- Para **dark fantasy**, a recomendação de distribuição 60-30-10 é:
  *Base* azul-ardósia/ameixa · *Suporte* vermelho-sangue seco · *Acento*
  dourado fosco. [4](https://vsquad.art/blog/articles/mastering-the-triadic-color-scheme-bold-harmony-for-your-designs/)

## 3. Paleta final (3 cores exatas)

Cruzando as duas etapas — clima gótico do Adobe + acento dourado de "brasa"
com a disciplina de 3 cores do Game Boy/Downwell:

| Papel | Hex | RGB | Uso no jogo |
|-------|-----|-----|-------------|
| **Tinta / escuridão** (base 60%) | `#120B17` | 18, 11, 23 | fundo, sombra, rostos, névoa |
| **Pedra / violeta-rosa** (suporte 30%) | `#8C3B5A` | 140, 59, 90 | paredes, manto, HUD, tramados |
| **Chama / dourado** (acento 10%) | `#F2C66D` | 242, 198, 109 | brasa, lembranças, tochas, texto |

O dourado funciona como **complementar quente** do violeta-rosa frio (a chama
"acende" contra o esquecimento). Nenhum outro valor RGB é desenhado no canvas:
os degradês da lanterna são feitos por **dithering** entre esses 3 tons, não por
novas cores. É a mesma lógica do registro BGP do Game Boy, só que aplicada à
luz em vez de a sprites.

---
*Referências consultadas em 23/10/2026. Links citados com seus índices de busca.*
