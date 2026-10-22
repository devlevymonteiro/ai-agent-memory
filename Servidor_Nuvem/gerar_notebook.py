#!/usr/bin/env python3
"""Gera Servidor_Nuvem/hermes_cloud_backend.ipynb (nbformat 4.5).

Uso:  python3 gerar_notebook.py
Requisito:  pip install nbformat
"""
import nbformat as nbf
from pathlib import Path

nb = nbf.v4.new_notebook()
nb.metadata = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python", "version": "3.11"},
    "title": "Hermes Cloud Backend - Ollama + Gemma 2 9B + Cloudflare Tunnel",
}
cells = []
md = lambda s: cells.append(nbf.v4.new_markdown_cell(s.strip()))
co = lambda s: cells.append(nbf.v4.new_code_cell(s.strip()))

# ----------------------------------------------------------------------------
md(r'''
# ☁️ Servidor_Nuvem — Backend Hermes Cloud

**Stack:** `Ollama` (runtime de inferência) + `Gemma 2 9B` (modelo) + `Cloudflare Tunnel` (exposição pública sem abrir portas no firewall).

```
Internet ──► Cloudflare Edge ──► cloudflared (tunnel, conexão SAINDO da máquina)
                                        │
                                        ▼
                            http://127.0.0.1:11434  (Ollama)
                                        │
                                        ▼
                                   gemma2:9b  /  alias "hermes"
```

> **Por que tunnel e não port-forward?** O `cloudflared` abre uma conexão **de dentro para fora**.
> Você não expõe a porta 11434 no roteador, não precisa de IP público, não abre regra de
> firewall e o IP real da máquina nunca aparece no DNS. É o caminho mais seguro para servir
> uma API que roda atrás de NAT.

---

### Como usar este notebook

* Todas as células de sistema são **bash** executadas com a magic `%%bash` — funciona no kernel
  Python padrão do Jupyter/JupyterLab/VS Code, sem kernel especial.
* Rode **em ordem, de cima para baixo**. Cada célula `%%bash` abre um shell novo e independente,
  por isso todas elas fazem `source ~/Servidor_Nuvem/.env` para recuperar as variáveis.
* Nada aqui é destrutivo por padrão. As células de *teardown* estão no fim e avisam.
* Células marcadas com ⚠️ exigem decisão sua (senha, domínio, token). Não pule.

### Requisitos da máquina alvo

| Item | Mínimo para `gemma2:9b` | Recomendado |
|---|---|---|
| SO | Linux (Debian/Ubuntu/Arch/Fedora), macOS ou WSL2 | Linux com `systemd` |
| RAM | 12 GB livres | 16 GB+ |
| VRAM (opcional) | 6–8 GB (Q4) | 12 GB+ |
| Disco | 8 GB livres (modelo ocupa **5,4 GB**) | NVMe |
| Rede | Saída HTTPS (443) liberada | — |
| Cloudflare | Conta gratuita | Domínio próprio na Cloudflare (p/ túnel nomeado) |

> O modelo `gemma2:9b` tem **9,24 B de parâmetros**, quantização **Q4_0** e **5,4 GB** de download.
> Em CPU pura ele funciona, mas espere alguns tokens/segundo; em GPU, dezenas.

### ⚠️ Aviso de segurança que você precisa ler antes da Seção 4

**O Ollama não tem autenticação. Nenhuma.** Quem alcança a porta 11434 roda o modelo de graça
na sua máquina, lê os prompts dos outros usuários e pode derrubar o host por exaustão de memória.
Expor 11434 "na internet" sem uma camada de auth na frente é equivalente a publicar um
minerador de cripto com o seu nome. A **Seção 5** deste notebook resolve isso (Cloudflare Access
ou proxy Caddy com Basic Auth). Ela é **obrigatória** para uso real, não opcional.
''')

# ----------------------------------------------------------------------------
md('## 0. Preparação — cria a pasta de trabalho e o arquivo `.env`')

co(r'''%%bash
# Cria fisicamente a pasta Servidor_Nuvem e o arquivo de configuração central.
# Idempotente: rodar de novo não apaga nada.
set -euo pipefail

PROJ="$HOME/Servidor_Nuvem"
mkdir -p "$PROJ"
cd "$PROJ"

# --- Edite estas 4 linhas antes de continuar -------------------------------
if [ ! -f .env ]; then
cat > .env <<EOF
PROJECT_DIR=$PROJ
MODEL=gemma2:9b
MODEL_ALIAS=hermes
TUNNEL_NAME=hermes-cloud
PUBLIC_HOSTNAME=hermes.example.com
PROXY_USER=hermes
PROXY_PASSWORD=troque-esta-senha-agora
EOF
  chmod 600 .env
  echo "✔ .env criado — ABRA E EDITE PUBLIC_HOSTNAME e PROXY_PASSWORD"
else
  echo "✔ .env já existe, mantido intacto"
fi

mkdir -p logs
echo
echo "== Conteúdo atual de ~/Servidor_Nuvem =="
ls -la
echo
echo "== .env =="
cat .env
''')

co(r'''%%bash
# Diagnóstico do ambiente (somente leitura — não altera nada).
set -uo pipefail
echo "==================== HOST ===================="
uname -a
( . /etc/os-release 2>/dev/null && echo "Distro: $PRETTY_NAME" ) || echo "Distro: desconhecida"
echo
echo "================= CPU / RAM =================="
echo "vCPUs: $(nproc)"
free -h | head -n 2
echo
echo "================== DISCO ====================="
df -h / | tail -n 1
echo "Espaço livre necessário: 8 GB (5,4 GB do modelo + folga)"
echo
echo "================== GPU ======================="
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
else
  echo "Sem GPU NVIDIA detectada -> inferência em CPU (funciona, porém lento)"
fi
echo
echo "=============== FERRAMENTAS =================="
for b in curl wget systemctl sudo python3 ollama cloudflared caddy; do
  printf "  %-12s %s\n" "$b" "$(command -v "$b" 2>/dev/null || echo '— AUSENTE —')"
done
echo
echo "================ PORTA 11434 ================="
if command -v ss >/dev/null 2>&1; then
  ss -ltnp 2>/dev/null | grep -E '11434|:8080' || echo "  11434 livre (esperado antes da instalação)"
fi
''')

# ----------------------------------------------------------------------------
md(r'''
---
## 1. Instalar o Ollama

O script oficial `https://ollama.com/install.sh`:

1. Detecta distro e arquitetura;
2. Instala o binário em `/usr/local/bin/ollama` (com bibliotecas ROCm/CUDA quando há GPU);
3. Cria o usuário de sistema `ollama`;
4. Registra e inicia o serviço `systemd` `ollama.service`, que escuta em `127.0.0.1:11434`.

**Boa prática de engenharia:** baixe o script e leia antes de executar.
`curl ... | sh` executa código remoto sem revisão — aceitável para o script oficial do
fabricante, mas a auditoria custa 10 segundos e é o hábito correto.
''')

co(r'''%%bash
# 1.1 — Baixa o instalador e audita (não executa nada ainda).
set -euo pipefail
curl -fsSL https://ollama.com/install.sh -o /tmp/ollama_install.sh
echo "✔ Baixado: $(wc -l < /tmp/ollama_install.sh) linhas, $(du -h /tmp/ollama_install.sh | cut -f1)"
echo
echo "==================== PRIMEIRAS 30 LINHAS ===================="
sed -n '1,30p' /tmp/ollama_install.sh
echo
echo "==================== O QUE ELE FAZ (grep) ===================="
grep -nE 'install -m|systemctl|useradd|curl -|/usr/local/bin|download' /tmp/ollama_install.sh | head -n 25
''')

co(r'''%%bash
# 1.2 — Instala de fato. Pode levar 1-3 minutos (baixa ~1 GB com libs de GPU).
set -euo pipefail
sudo sh /tmp/ollama_install.sh
echo
echo "✔ Binário: $(command -v ollama)"
ollama --version
''')

co(r'''%%bash
# 1.3 — Garante que o serviço está ativo e habilitado no boot.
#      Se não houver systemd (WSL2, container, Docker), sobe 'ollama serve' manualmente.
set -uo pipefail
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^ollama\.service'; then
  sudo systemctl enable --now ollama
  echo "==================== STATUS ===================="
  systemctl --no-pager --lines=0 status ollama | head -n 12
else
  echo "⚠ systemd indisponível -> iniciando 'ollama serve' em background"
  nohup ollama serve > "$HOME/Servidor_Nuvem/logs/ollama-serve.log" 2>&1 &
  sleep 4
  echo "  PID: $(pgrep -f 'ollama serve' | head -n1)  log: ~/Servidor_Nuvem/logs/ollama-serve.log"
fi
''')

co(r'''%%bash
# 1.4 — Health check da API local (espera o socket responder).
set -uo pipefail
OK=0
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then OK=1; break; fi
  printf '  aguardando Ollama responder... (%s/20)\n' "$i"; sleep 2
done
if [ "$OK" -eq 1 ]; then
  echo "✔ Ollama UP"
  echo -n "  /api/version -> "; curl -s http://127.0.0.1:11434/api/version
  echo
  echo "  Endpoint: http://127.0.0.1:11434"
else
  echo "✘ Ollama NÃO respondeu em 40s. Verifique: journalctl -u ollama -n 50"
  exit 1
fi
echo
echo "== Confirmação de que só escuta em loopback (correto) =="
ss -ltnp 2>/dev/null | grep 11434 || echo "  (ss indisponível)"
''')

# ----------------------------------------------------------------------------
md(r'''
---
## 2. Baixar o modelo Gemma 2 9B

Tag no Ollama: **`gemma2:9b`** → 9,24 B parâmetros, quantização `Q4_0`, **5,4 GB**, contexto 8K.

* O `pull` é retomável: se cair a conexão, rode de novo.
* O download fica em `~/.ollama/models` (ou `/usr/share/ollama/.ollama/models` quando roda
  como serviço systemd — o usuário `ollama` é o dono).
* Se o disco estiver cheio o processo morre com `signal: killed`. Cheque o `df` da célula 0.
''')

co(r'''%%bash
# 2.1 — Download do modelo (~5,4 GB). Tempo varia com a banda; pode levar vários minutos.
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"
echo "Baixando $MODEL (5,4 GB) ..."
ollama pull "$MODEL"
echo
echo "✔ Pull concluído"
echo "ℹ Se o Ollama pedir aceite de licença do Gemma, rode o mesmo comando num"
echo "  terminal, confirme o prompt e execute esta célula novamente."
''')

co(r'''%%bash
# 2.2 — Confere o que está instalado.
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"
echo "================== ollama list =================="
ollama list
echo
echo "================== ollama show =================="
ollama show "$MODEL"
echo
echo "=========== DISCO OCUPADO PELOS MODELOS ==========="
du -sh "${OLLAMA_MODELS:-$HOME/.ollama/models}" 2>/dev/null \
  || sudo du -sh /usr/share/ollama/.ollama/models 2>/dev/null || true
''')

co(r'''%%bash
# 2.3 — Smoke test de inferência LOCAL (mede latência real da sua máquina).
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"
echo "Primeira chamada carrega o modelo em RAM/VRAM — pode demorar 10-60s."
time curl -s http://127.0.0.1:11434/api/generate -d '{
  "model": "'"$MODEL"'",
  "stream": false,
  "options": { "num_predict": 64, "temperature": 0.2 },
  "prompt": "Responda em uma única frase: qual é o seu nome de modelo e o seu tamanho?"
}' | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("RESPOSTA:", d.get("response","").strip())
print("---")
print("tokens gerados :", d.get("eval_count"))
dur = d.get("eval_duration") or 0
n = d.get("eval_count") or 0
print("duração (s)    :", round(dur/1e9, 2))
print("throughput     :", round(n/(dur/1e9), 1), "tok/s" if dur else "n/d")
print("load (s)       :", round((d.get("load_duration") or 0)/1e9, 2))
'
''')

# ----------------------------------------------------------------------------
md(r'''
---
## 3. Fixar o modelo como API estável (alias `hermes`)

Apontar a aplicação direto para `gemma2:9b` amarra seu código a uma tag que pode ser
substituída por um update. Crie um **alias versionado** via `Modelfile` com o *system prompt*
e os parâmetros de inferência embutidos. Para trocar o modelo depois, basta editar uma linha
do `Modelfile` e rodar `ollama create` de novo — os clientes não mudam.
''')

co(r'''%%bash
# 3.1 — Modelfile + criação do alias 'hermes'.
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"
cd "$PROJECT_DIR"

cat > Modelfile <<EOF
FROM $MODEL

PARAMETER temperature 0.2
PARAMETER top_p 0.9
PARAMETER num_ctx 8192
PARAMETER repeat_penalty 1.1

SYSTEM """Você é o Hermes, o backend de IA do projeto Servidor_Nuvem.
Responda de forma objetiva, técnica e em português do Brasil.
Quando o usuário enviar JSON, valide o conteúdo e responda somente JSON válido,
sem texto adicional e sem cercas de código."""
EOF

echo "== Modelfile =="
cat Modelfile
echo
ollama create "$MODEL_ALIAS" -f Modelfile
echo
echo "== Modelos disponíveis =="
ollama list
''')

co(r'''%%bash
# 3.2 — Testa o alias e mantém o modelo quente em memória (evita cold-start de ~30s por request).
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"
curl -s http://127.0.0.1:11434/api/chat -d '{
  "model": "'"$MODEL_ALIAS"'",
  "stream": false,
  "keep_alive": "24h",
  "messages": [
    {"role": "user", "content": "{\"status\":\"healthcheck\"} Responda somente JSON confirmando."}
  ]
}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["message"]["content"])'
echo
echo "================== ollama ps (modelo carregado) =================="
ollama ps
''')

# ----------------------------------------------------------------------------
md(r'''
---
## 4. Expor a porta 11434 via Cloudflare Tunnel

O `cloudflared` faz uma conexão **outbound** persistente para a edge da Cloudflare. Nenhuma
porta de entrada precisa ser aberta. Existem três modos — escolha um:

| Modo | Precisa de conta? | Precisa de domínio? | URL resultante | Uso |
|---|---|---|---|---|
| **4.2 Quick Tunnel** | Não | Não | `https://<aleatório>.trycloudflare.com` | Teste rápido / demo |
| **4.3 Remotamente gerenciado** | Sim (grátis) | Sim | `https://hermes.seudominio.com` | **Produção (recomendado)** |
| **4.4 Localmente gerenciado** | Sim (grátis) | Sim | `https://hermes.seudominio.com` | Quando você quer o config em Git |

> O Quick Tunnel gera uma URL **efêmera e imprevisível**, mas **pública e sem autenticação**.
> Serve para validar o fluxo; nunca deixe rodando como solução final.
''')

co(r'''%%bash
# 4.1 — Instala o cloudflared (Debian/Ubuntu). Detecta a arquitetura automaticamente.
set -euo pipefail
if command -v cloudflared >/dev/null 2>&1; then
  echo "✔ cloudflared já instalado: $(cloudflared --version | head -n1)"
  exit 0
fi
ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
echo "Arquitetura detectada: $ARCH"
curl -fsSL -o /tmp/cloudflared.deb \
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
sudo dpkg -i /tmp/cloudflared.deb || sudo apt-get install -f -y
echo
echo "✔ $(cloudflared --version)"
echo
echo "ℹ Em RHEL/Fedora use o .rpm da mesma release:"
echo "   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.rpm"
''')

co(r'''%%bash --no-raise-error
# 4.2 — QUICK TUNNEL (teste, sem conta Cloudflare). URL efêmera.
set -uo pipefail
source "$HOME/Servidor_Nuvem/.env"
cd "$PROJECT_DIR"

pkill -f 'cloudflared tunnel --url' 2>/dev/null && sleep 2
nohup cloudflared tunnel --url http://127.0.0.1:11434 --no-autoupdate \
  > logs/cloudflared-quick.log 2>&1 &
echo "cloudflared PID: $!"

URL=""
for i in $(seq 1 15); do
  URL=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' logs/cloudflared-quick.log | head -n1)
  [ -n "$URL" ] && break
  sleep 2
done

if [ -n "$URL" ]; then
  echo "$URL" > public_url.txt
  echo "✔ URL pública (efêmera): $URL"
  echo "  Teste: curl $URL/api/version"
else
  echo "✘ URL não obtida. Log:"; tail -n 20 logs/cloudflared-quick.log
fi
''')

co(r'''%%bash --no-raise-error
# 4.2b — Valida o Quick Tunnel de ponta a ponta.
set -uo pipefail
source "$HOME/Servidor_Nuvem/.env"
URL="$(cat "$PROJECT_DIR/public_url.txt" 2>/dev/null || true)"
[ -z "$URL" ] && { echo "✘ rode a célula 4.2 primeiro"; exit 1; }

echo "GET $URL/api/version"
curl -sS -o /dev/null -w "  HTTP %{http_code}  em %{time_total}s\n" "$URL/api/version"
echo
echo "GET $URL/api/tags"
curl -sS "$URL/api/tags" | python3 -m json.tool | head -n 25
''')

md(r'''
### 4.3 — Túnel nomeado, **remotamente gerenciado** (recomendado para produção)

O config fica na Cloudflare (dashboard **Zero Trust → Networks → Tunnels**) e o binário local
só precisa do **token**. Vantagens operacionais: você muda o hostname/ingress pelo dashboard
sem tocar no servidor, o token pode ser rotacionado sem redeploy, e múltiplas réplicas do
mesmo túnel dão alta disponibilidade automaticamente.

Passos no navegador:

1. `https://one.dash.cloudflare.com/` → **Networks → Tunnels → Create a tunnel**
2. Tipo **Cloudflared** → dê o nome `hermes-cloud`
3. Ambiente **Linux** → **copie o token** (string que começa com `eyJ...`)
4. Na aba **Public Hostname**: hostname `hermes`, domínio `seudominio.com`,
   serviço `HTTP` → `127.0.0.1:11434`
''')

co(r'''%%bash
# ⚠️ 4.3 — Cole o token no lugar indicado e execute.
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"

TUNNEL_TOKEN="COLE_AQUI_O_TOKEN_DO_DASHBOARD"   # <<< EDITAR

if [ "$TUNNEL_TOKEN" = "COLE_AQUI_O_TOKEN_DO_DASHBOARD" ]; then
  echo "✘ Edite TUNNEL_TOKEN nesta célula antes de rodar."; exit 1
fi

# 'service install <token>' cria a unit systemd já apontando para o túnel remoto.
sudo cloudflared service install "$TUNNEL_TOKEN"
sudo systemctl enable --now cloudflared
echo
systemctl --no-pager --lines=0 status cloudflared | head -n 10
echo
echo "== Últimas linhas do log =="
sudo journalctl -u cloudflared -n 15 --no-pager
''')

md(r'''
### 4.4 — Alternativa: túnel **localmente gerenciado** via CLI

Use quando quiser versionar o `config.yml` no Git junto com o resto da infraestrutura.

> **Pegadinha conhecida:** `cloudflared service install` **copia** o config encontrado para
> `/etc/cloudflared/config.yml` e grava `--config /etc/cloudflared/config.yml` na unit do
> systemd. Se você editar depois a cópia em `~/.cloudflared/`, **nada acontece** e o serviço
> continua servindo as regras antigas, sem aviso. Por isso as células abaixo escrevem o config
> **direto em `/etc/cloudflared/`** e movem as credenciais para lá também.
''')

co(r'''%%bash --no-raise-error
# 4.4a — Login + criação do túnel. Abre o navegador para autorizar; baixa cert.pem.
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"

cloudflared tunnel login
echo "✔ cert.pem em $HOME/.cloudflared/"

cloudflared tunnel create "$TUNNEL_NAME" || echo "(túnel já existia, seguindo)"
echo
cloudflared tunnel list
''')

co(r'''%%bash
# 4.4b — Config em /etc/cloudflared + registro DNS (CNAME proxied para <uuid>.cfargotunnel.com)
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"

TUNNEL_ID=$(cloudflared tunnel list --output json \
  | python3 -c "import sys,json;print(next(t['id'] for t in json.load(sys.stdin) if t['name']=='$TUNNEL_NAME'))")
echo "Tunnel ID: $TUNNEL_ID"

sudo mkdir -p /etc/cloudflared
sudo cp "$HOME/.cloudflared/${TUNNEL_ID}.json" /etc/cloudflared/
sudo chown root:root "/etc/cloudflared/${TUNNEL_ID}.json"
sudo chmod 600 "/etc/cloudflared/${TUNNEL_ID}.json"

sudo tee /etc/cloudflared/config.yml > /dev/null <<EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json
loglevel: info
metrics: 127.0.0.1:20241

ingress:
  # 11434 atrás do proxy com auth da Seção 5.
  # Troque para http://127.0.0.1:11434 se decidir NÃO usar o proxy (não recomendado).
  - hostname: $PUBLIC_HOSTNAME
    service: http://127.0.0.1:8080
    originRequest:
      connectTimeout: 60s
      keepAliveTimeout: 60s
  - service: http_status:404
EOF

echo "== /etc/cloudflared/config.yml =="
sudo cat /etc/cloudflared/config.yml
echo
cloudflared tunnel ingress validate --config /etc/cloudflared/config.yml
echo "✔ ingress válido"
echo
cloudflared tunnel route dns "$TUNNEL_NAME" "$PUBLIC_HOSTNAME"
echo "✔ DNS: $PUBLIC_HOSTNAME -> ${TUNNEL_ID}.cfargotunnel.com"
''')

co(r'''%%bash
# 4.4c — Sobe o serviço de forma persistente (sobrevive a reboot).
set -euo pipefail
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
sudo systemctl restart cloudflared
sleep 5
echo "==================== STATUS ===================="
systemctl --no-pager --lines=0 status cloudflared | head -n 12
echo
echo "==================== MÉTRICAS ===================="
curl -s http://127.0.0.1:20241/healthcheck 2>/dev/null || echo "  (métricas indisponíveis)"
''')

# ----------------------------------------------------------------------------
md(r'''
---
## 5. 🔒 Autenticação na frente do Ollama — **não pule esta seção**

Repetindo o risco: `curl https://seu-host/api/generate` sem auth = qualquer pessoa na internet
consome CPU/GPU/RAM da sua máquina indefinidamente. Escolha **uma** das duas defesas abaixo
(a 5.1 é melhor; a 5.2 é a que funciona sem dashboard).

### 5.1 — Cloudflare Access (recomendado, zero código)

1. `https://one.dash.cloudflare.com/` → **Access → Applications → Add an application** → *Self-hosted*
2. Domínio: `hermes.seudominio.com`
3. **Add a policy**: action `Allow`, include `Emails` = seu e-mail (ou `Service Auth` para M2M)
4. Pronto: sem o login Cloudflare, o Cloudflare devolve a tela de autenticação antes de tocar no Ollama.

Para chamadas **máquina-a-máquina** (seu backend, cron, etc.), crie um *Service Token* e envie:

```
CF-Access-Client-Id:     <id>.access.cloudflare.com
CF-Access-Client-Secret: <secret>
```

### 5.2 — Proxy reverso Caddy com Basic Auth (defesa local, independente da Cloudflare)
''')

co(r'''%%bash
# 5.2a — Instala o Caddy (repositório oficial).
set -euo pipefail
if command -v caddy >/dev/null 2>&1; then echo "✔ caddy já instalado"; exit 0; fi
sudo apt-get update -y
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y caddy
echo "✔ $(caddy version)"
''')

co(r'''%%bash
# 5.2b — ⚠️ Define senha forte, gera hash bcrypt e escreve o Caddyfile.
#         Caddy escuta em 127.0.0.1:8080 -> só o cloudflared consegue alcançá-lo.
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"

if [ "$PROXY_PASSWORD" = "troque-esta-senha-agora" ]; then
  # Gera uma senha aleatória de 24 chars e grava no .env (chmod 600).
  NEW=$(openssl rand -base64 24 2>/dev/null | tr -d '/+=' | cut -c1-24)
  sed -i "s|^PROXY_PASSWORD=.*|PROXY_PASSWORD=$NEW|" "$HOME/Servidor_Nuvem/.env"
  source "$HOME/Servidor_Nuvem/.env"
  echo "⚠ Senha gerada e gravada em ~/Servidor_Nuvem/.env"
fi

HASH=$(caddy hash-password --plaintext "$PROXY_PASSWORD")
echo "Usuário : $PROXY_USER"
echo "Senha   : $PROXY_PASSWORD   (está no .env, modo 600)"

sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
127.0.0.1:8080 {
	basic_auth {
		$PROXY_USER $HASH
	}
	reverse_proxy 127.0.0.1:11434 {
		header_up Host {upstream_hostport}
	}
}
EOF

sudo systemctl enable --now caddy
sudo systemctl restart caddy
sleep 3
systemctl --no-pager --lines=0 status caddy | head -n 8
echo
echo "== Sem credencial (esperado: 401) =="
curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://127.0.0.1:8080/api/version
echo "== Com credencial (esperado: 200) =="
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -u "$PROXY_USER:$PROXY_PASSWORD" http://127.0.0.1:8080/api/version
''')

md(r'''
### Defesa em profundidade — checklist

- [ ] Ollama escuta **só** em `127.0.0.1` (nunca configure `OLLAMA_HOST=0.0.0.0`).
- [ ] Caddy/Access na frente, exigindo credencial.
- [ ] Nenhuma porta aberta no roteador para 11434/8080.
- [ ] `.env` com `chmod 600` e **fora** do Git.
- [ ] `num_ctx` limitado (8192) — contexto gigante é vetor de OOM.
- [ ] Log de acesso monitorado; considere rate-limit no Caddy.
''')

co(r'''%%bash
# 5.3 — Auditoria: o que está realmente escutando nesta máquina?
set -uo pipefail
echo "== Sockets em LISTEN =="
sudo ss -ltnp 2>/dev/null | awk 'NR==1 || /11434|8080|:80 |:443 /'
echo
echo "== Ollama deve aparecer APENAS em 127.0.0.1:11434 =="
if sudo ss -ltn 2>/dev/null | grep -E '(0\.0\.0\.0|\*):11434' >/dev/null; then
  echo "✘ PERIGO: 11434 exposto em todas as interfaces. Corrija o OLLAMA_HOST."
else
  echo "✔ OK: 11434 restrito ao loopback."
fi
''')

# ----------------------------------------------------------------------------
md('## 6. Verificação de ponta a ponta (Internet → Edge → Tunnel → Caddy → Ollama)')

co(r'''%%bash
# 6.1 — Testa o endpoint público completo, com autenticação.
set -euo pipefail
source "$HOME/Servidor_Nuvem/.env"
URL="https://${PUBLIC_HOSTNAME}"
# Se ainda está no hostname de exemplo e existe um Quick Tunnel ativo, usa a URL efêmera.
if [ -f "$PROJECT_DIR/public_url.txt" ] && [ "$PUBLIC_HOSTNAME" = "hermes.example.com" ]; then
  URL="$(cat "$PROJECT_DIR/public_url.txt")"
fi
echo "Alvo: $URL"
echo

echo "[1] GET /api/version"
curl -sS -o /dev/null -w "    HTTP %{http_code} | %{time_total}s\n" \
  -u "$PROXY_USER:$PROXY_PASSWORD" "$URL/api/version"

echo "[2] GET /api/tags (modelos publicados)"
curl -sS -u "$PROXY_USER:$PROXY_PASSWORD" "$URL/api/tags" \
  | python3 -c 'import sys,json;[print("    -",m["name"]) for m in json.load(sys.stdin)["models"]]'

echo "[3] POST /api/chat (inferência real)"
curl -sS -X POST "$URL/api/chat" \
  -H 'Content-Type: application/json' \
  -u "$PROXY_USER:$PROXY_PASSWORD" \
  -d '{"model":"'"$MODEL_ALIAS"'","stream":false,"options":{"num_predict":48},
       "messages":[{"role":"user","content":"ping"}]}' \
  | python3 -c 'import sys,json;print("    RESPOSTA:", json.load(sys.stdin)["message"]["content"].strip())'

echo "[4] Sem autenticação (esperado 401 se o proxy estiver ativo)"
curl -sS -o /dev/null -w "    HTTP %{http_code}\n" "$URL/api/version"
''')

co(r'''# 6.2 — Cliente Python usando o endpoint compatível com OpenAI (/v1).
#     Instale antes:  pip install openai httpx
import base64
import pathlib

# Lê as credenciais do .env criado na célula 0.
proj = pathlib.Path.home() / "Servidor_Nuvem"
env = {}
for line in (proj / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"')

base_url = f"https://{env['PUBLIC_HOSTNAME']}/v1"
quick = proj / "public_url.txt"
if quick.exists() and env["PUBLIC_HOSTNAME"] == "hermes.example.com":
    base_url = quick.read_text().strip() + "/v1"   # Quick Tunnel da célula 4.2

print("base_url :", base_url)
print("modelo   :", env["MODEL_ALIAS"])

try:
    import httpx
    from openai import OpenAI
except ImportError:
    print("\n[!] Pacotes ausentes. Rode:  pip install openai httpx")
    raise SystemExit(0)

# O Ollama não autentica; quem autentica é o proxy da Seção 5. O Basic Auth vai
# no header HTTP diretamente — o campo api_key do SDK é ignorado pelo Ollama.
cred = base64.b64encode(f"{env['PROXY_USER']}:{env['PROXY_PASSWORD']}".encode()).decode()
http_client = httpx.Client(
    headers={"Authorization": f"Basic {cred}"},
    timeout=180.0,   # o cold-start do modelo pode passar de 60 s
)

client = OpenAI(base_url=base_url, api_key="nao-usado-pelo-ollama", http_client=http_client)

models = client.models.list()
print("\nModelos publicados:", [m.id for m in models.data])

resp = client.chat.completions.create(
    model=env["MODEL_ALIAS"],
    messages=[{"role": "user", "content": "Apresente-se em uma frase."}],
    max_tokens=80,
    temperature=0.2,
)
print("\nRESPOSTA:", resp.choices[0].message.content)
print("tokens  :", resp.usage)

http_client.close()
''')

md(r'''
> **Variações de autenticação no cliente**
>
> Com **Cloudflare Access** + Service Token (Seção 5.1) em vez do Caddy, troque o header:
>
> ```python
> http_client = httpx.Client(headers={
>     "CF-Access-Client-Id":     "<id>.access.cloudflare.com",
>     "CF-Access-Client-Secret": "<secret>",
> })
> ```
>
> Equivalente em `curl`, útil para monitoramento e smoke tests no CI:
>
> ```bash
> curl -sS -u "$PROXY_USER:$PROXY_PASSWORD" https://<host>/api/version
> curl -sS -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" \
>      https://<host>/api/tags
> ```
>
> Lembre: `api_key` no SDK é ignorado pelo Ollama — quem decide é a camada na frente dele.
''')

# ----------------------------------------------------------------------------
md('## 7. Operação — logs, recursos, atualização')

co(r'''%%bash
# 7.1 — Painel de observabilidade.
set -uo pipefail
source "$HOME/Servidor_Nuvem/.env"
echo "==================== SERVIÇOS ===================="
for s in ollama cloudflared caddy; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$s\.service"; then
    printf "  %-12s %s\n" "$s" "$(systemctl is-active $s) / $(systemctl is-enabled $s 2>/dev/null)"
  fi
done
echo
echo "==================== OLLAMA ======================"
ollama ps
echo
echo "==================== RECURSOS ===================="
free -h | head -n2
nproc >/dev/null && echo "load:$(cat /proc/loadavg)"
echo
echo "================== LOGS (últimas 15) ============="
echo "--- ollama ---";     sudo journalctl -u ollama     -n 15 --no-pager 2>/dev/null || echo "  n/d"
echo "--- cloudflared ---"; sudo journalctl -u cloudflared -n 15 --no-pager 2>/dev/null || echo "  n/d"
echo "--- caddy ---";      sudo journalctl -u caddy      -n 10 --no-pager 2>/dev/null || echo "  n/d"
''')

co(r'''%%bash
# 7.2 — Atualiza os componentes (seguro: mantém modelos e túneis).
set -euo pipefail
echo "== Ollama =="
curl -fsSL https://ollama.com/install.sh | sudo sh
systemctl --no-pager --lines=0 status ollama | head -n 4
echo
echo "== cloudflared =="
cloudflared update || sudo apt-get install --only-upgrade -y cloudflared
sudo systemctl restart cloudflared
cloudflared --version
echo
echo "== Re-teste rápido =="
curl -s -o /dev/null -w "  local  /api/version -> HTTP %{http_code}\n" http://127.0.0.1:11434/api/version
''')

md(r'''
## 8. Troubleshooting

| Sintoma | Causa provável | Correção |
|---|---|---|
| `dial tcp 127.0.0.1:11434: connect: connection refused` | Ollama parado | `sudo systemctl restart ollama` |
| `signal: killed` durante o `pull` | Disco cheio ou OOM | `df -h /`, `dmesg \| tail -50` |
| Modelo carrega e some do `ollama ps` | Sem RAM para os pesos + KV cache | Reduza `num_ctx`, ou use `gemma2:2b` |
| `502 Bad Gateway` na URL pública | Origem fora do ar / porta errada no ingress | `systemctl status ollama`, confira `service:` no config |
| `ERR 1033` / `Argo Tunnel error` | Túnel não conectado ou DNS não roteado | `cloudflared tunnel info <nome>`, refaça `route dns` |
| Editou o config e nada mudou | Serviço usando `/etc/cloudflared/config.yml` | Edite **esse** arquivo e `sudo systemctl restart cloudflared` |
| `401` mesmo com senha certa | Hash bcrypt expandido errado pelo shell | Refaça `caddy hash-password` e regere o Caddyfile |
| Respostas muito lentas | CPU pura / swap ativo | `ollama ps` mostra se está em GPU; considere GPU ou modelo menor |
| `ollama pull` pede login/licença | Aceite os termos do Gemma em `ollama.com/library/gemma2` | Rode `ollama pull gemma2:9b` num terminal e confirme |

Logs úteis:

```bash
sudo journalctl -u ollama -f          # runtime de inferência
sudo journalctl -u cloudflared -f     # túnel
sudo journalctl -u caddy -f           # proxy/auth
tail -f ~/Servidor_Nuvem/logs/cloudflared-quick.log
```
''')

co(r'''%%bash --no-raise-error
# 9 — ⚠️ TEARDOWN. Descomente o que quiser remover. Não roda nada por padrão.
set -uo pipefail
echo "Célula de destruição — edite e descomente conscientemente."
echo

# --- Remover exposição pública -------------------------------------------
# pkill -f 'cloudflared tunnel --url'                        # para o Quick Tunnel
# sudo systemctl disable --now cloudflared
# sudo cloudflared service uninstall
# sudo rm -f /etc/cloudflared/config.yml /etc/cloudflared/*.json

# --- Remover o proxy de auth ----------------------------------------------
# sudo systemctl disable --now caddy

# --- Remover modelos (libera ~5,4 GB) -------------------------------------
# source "$HOME/Servidor_Nuvem/.env"
# ollama rm "$MODEL" "$MODEL_ALIAS"
# ollama list

# --- Desinstalar o Ollama --------------------------------------------------
# sudo systemctl disable --now ollama
# sudo rm -f /etc/systemd/system/ollama.service /usr/local/bin/ollama
# sudo userdel -r ollama 2>/dev/null; sudo groupdel ollama 2>/dev/null
# sudo rm -rf /usr/share/ollama

echo "(nada foi removido)"
''')

md(r'''
---
## ✅ Checklist final

- [ ] `~/Servidor_Nuvem/.env` criado, com `PUBLIC_HOSTNAME` e senha reais, `chmod 600`
- [ ] `ollama --version` responde e `systemctl is-active ollama` = `active`
- [ ] `ollama list` mostra `gemma2:9b` **e** o alias `hermes`
- [ ] `ollama ps` mantém o modelo carregado após um request (`keep_alive: 24h`)
- [ ] `cloudflared` ativo: `systemctl is-active cloudflared` = `active`
- [ ] `https://<hostname>/api/version` responde **200** com credencial
- [ ] `https://<hostname>/api/version` responde **401** sem credencial
- [ ] `ss -ltn` mostra 11434 **apenas** em `127.0.0.1`
- [ ] Nada de porta aberta no roteador/firewall
- [ ] Serviços habilitados no boot: `ollama`, `cloudflared`, `caddy`

**Superfície de API exposta** (compatível com OpenAI em `/v1`):

```
GET  /api/version          GET  /api/tags         GET  /api/ps
POST /api/generate         POST /api/chat         POST /api/embeddings
GET  /v1/models            POST /v1/chat/completions
```

---
*Gerado para o projeto `Servidor_Nuvem`. Rode as células em ordem e leia a Seção 5 antes de publicar qualquer hostname.*
''')

nb.cells = cells
out = Path(__file__).resolve().parent / "hermes_cloud_backend.ipynb"
nbf.write(nb, str(out), version=4)
print(f"✔ escrito: {out}  ({len(cells)} células, {out.stat().st_size} bytes)")
