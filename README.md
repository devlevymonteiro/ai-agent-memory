# WhatsApp Web — Demo funcional

Uma recriação funcional do WhatsApp Web: interface fiel (temas escuro e claro), mensagens em tempo real entre abas e dispositivos, recibos de entrega e leitura, presença online, digitação, grupos, mídia, mensagens de voz, reações, busca, chamadas (simuladas) e notificações.

> ⚠️ Demonstração independente, criada para estudo. Não é afiliada ao WhatsApp/Meta e não se conecta à rede oficial do WhatsApp. Todos os dados ficam no servidor local da demo.

## Rodando

```bash
npm install
npm start
# abra http://localhost:3000
```

Requisitos: Node.js 18+.

Para desenvolver com reload automático:

```bash
npm run dev
```

## Ver o app no navegador (importante)

`npm start` sobe o servidor na máquina onde ele roda. Se você estiver usando um sandbox/preview
(Arena, Codespaces, container), **`http://localhost:3000` não funciona no seu navegador** — use a
URL pública do preview, no formato `https://3000-<sandbox>.e2b.app`, que aparece no painel de
preview. O servidor já escuta em `0.0.0.0`, então qualquer proxy consegue encaminhar as requisições.

## Publicar na internet (grátis)

O app é um servidor Node comum (Express + SSE), então roda em qualquer PaaS com Docker ou Node.

**Render (blueprint pronto)** — `render.yaml` já está no repositório:

1. Suba o código no GitHub.
2. Em [render.com](https://render.com) → **New +** → **Blueprint** → escolha o repositório.
3. Confirme o serviço `whatsapp-web-demo` (plano free) e clique em **Apply**.

**Railway / Fly.io / Heroku-like** — use o `Dockerfile` ou o `Procfile` já incluídos:

```bash
# Railway
npm i -g @railway/cli && railway up
# Fly.io
fly launch --dockerfile Dockerfile
```

**Qualquer VPS** (Docker):

```bash
docker build -t whatsapp-web .
docker run -d -p 3000:3000 -v whatsapp-data:/data --name whatsapp-web whatsapp-web
```

### Variáveis de ambiente

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `PORT` | `3000` | porta HTTP (os PaaS definem automaticamente) |
| `DATA_DIR` | `./data` | pasta do `db.json` (JSON persistente) |
| `UPLOAD_DIR` | `./uploads` | pasta das mídias enviadas |

> Nos planos gratuitos o disco costuma ser **efêmero**: a cada deploy/restart o banco volta ao seed
> (as mensagens de demonstração). Para manter as conversas entre deploys, monte um volume e aponte
> `DATA_DIR`/`UPLOAD_DIR` para ele — no Railway, ex.: `DATA_DIR=/data`, `UPLOAD_DIR=/data/uploads`.

> A primeira requisição depois de um tempo ocioso pode levar ~30 s em planos free (cold start).

## Contas

- **Conta demo (1 clique):** Alex Moreira, com conversas, grupos e mensagens não lidas prontos.
- **Entrar/criar conta:** informe um telefone (ex.: `+55 (61) 99999-0001`) e um nome. Telefones já cadastrados apenas entram na conta existente.
- Para testar tempo real de verdade, abra uma janela anônima, crie outra conta com outro número e converse entre as duas janelas.
- Contatos demo respondem automaticamente (pode desativar em **Perfil e configurações → Respostas automáticas**).

## O que funciona

- **Tempo real via SSE**: mensagens, recibos, digitação e presença chegam sem recarregar.
- **Recibos**: ✓ enviada, ✓✓ entregue, ✓✓ azul quando lida (em grupos, azul quando todos leram).
- **Presença**: online/visto por último, "digitando…" no cabeçalho e na lista.
- **Mídia**: fotos, vídeos, documentos (até 25 MB), pré-visualização com legenda e lightbox.
- **Mensagens de voz**: gravação pelo microfone, waveform clicável, velocidade 1x/1.5x/2x.
- **Grupos**: criação com seleção de participantes, administrador, adicionar/remover participantes e sair do grupo.
- **Conversas**: fixar, silenciar, arquivar, limpar, responder citando, reagir, apagar para mim/todos, buscar mensagens.
- **Chamadas**: tela de chamada de voz/vídeo com registro no histórico (simulada, sem WebRTC).
- **Extras**: notificações do navegador, sons, atalhos (`Enter` envia, `Shift+Enter` quebra linha, `Ctrl/Cmd+K` busca), arrastar-e-soltar arquivos, layout responsivo com navegação mobile.

## Estrutura

```
server/
  index.js   API Express + SSE + uploads + respostas automáticas
  db.js      banco JSON persistente (data/db.json) com dados de demonstração
public/
  index.html  estrutura e ícones
  styles.css  temas, layout e componentes
  app.js      SPA (estado, SSE, chat, mídia, áudio, busca)
  favicon.svg ícone da aba
tests/
  smoke.mjs  teste de integração ponta a ponta da API e do tempo real
  ui.mjs     teste da interface em JSDOM
Dockerfile   imagem de produção (Node 22 alpine, porta 3000)
render.yaml  blueprint do Render (plano free)
Procfile     start para Railway/Heroku-like
```

### API principal

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/login` / `/api/demo` | sessão por telefone ou conta demo |
| GET | `/api/conversations` | conversas com prévia, não lidas e presença |
| GET/POST | `/api/conversations/:id/messages` | histórico paginado / envio |
| POST | `/api/conversations/:id/read` | recibo de leitura |
| POST | `/api/conversations/:id/typing` | indicador de digitação |
| PATCH | `/api/conversations/:id` | fixar / silenciar / arquivar |
| POST | `/api/conversations/:id/participants` | adicionar participante ao grupo |
| DELETE | `/api/conversations/:id/participants/:userId` | remover participante / sair do grupo |
| POST | `/api/upload` | upload de mídia (multipart) |
| GET | `/api/search?q=` | busca em todas as conversas |
| GET | `/api/events` | stream SSE em tempo real |

## Testes

```bash
npm test          # integração da API + SSE (servidor efêmero)
npm run test:ui   # interface real em JSDOM (login, envio, mídia, grupos…)
npm run test:all  # os dois
```

Os testes sobem um servidor efêmero em uma pasta temporária e validam autenticação, conversas, envio/recebimento em tempo real, recibos, upload, busca, grupos (incluindo participantes e permissões), reações, chamadas e as principais interações da interface — login, composer, digitação, citação, tema, busca, mídia, chamada e saída de grupo.

## Dados

- Persistência em `data/db.json`; arquivos em `uploads/` (ambos ignorados pelo Git).
- Para resetar a demonstração, pare o servidor e apague a pasta `data/`.

## Solução de problemas

- **Tela parada em “Conectando ao WhatsApp Web…”** — quase sempre é a URL errada (`localhost` no
  seu computador em vez da URL pública do preview) ou o servidor parado. Confira com
  `curl <url>/api/health` — deve devolver `{"ok":true}`.
- **Mensagens não chegam em tempo real** — algum proxy pode estar bufferizando o SSE; o app já envia
  `X-Accel-Buffering: no` e `Cache-Control: no-transform`. Em redes muito restritas, recarregue a
  página: os dados são recarregados por HTTP normal.
- **Áudio não grava** — microfone exige HTTPS (ou localhost) e permissão do navegador.
- **Dados voltaram ao início** — em PaaS free o disco é efêmero (veja a seção acima).
