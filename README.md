# gusta-screen

Serviço HTTP em `Node.js + Fastify + Playwright` que recebe uma URL pública de YouTube ou Twitch e devolve uma screenshot PNG do vídeo em tela cheia.

## O que o serviço faz

- Aceita `watch/live` públicos do YouTube.
- Aceita canal ao vivo e VOD públicos da Twitch.
- Entra em fullscreen pelo player.
- Aguarda anúncio terminar.
- Pula anúncio do YouTube quando o botão aparecer.
- Nunca devolve imagem com anúncio visível: se o anúncio persistir além do timeout, responde erro `504`.

## Fora de escopo do v1

- URLs privadas, members-only ou com geoblock.
- YouTube Shorts, Twitch Clips e formatos fora do padrão.
- Filas assíncronas, armazenamento de screenshots e autenticação da API.

## Requisitos

- Node `22+`
- `pnpm`
- Chromium do Playwright instalado localmente

## Rodando localmente

```bash
cp .env.example .env
pnpm install
pnpm prepare:browsers
pnpm dev
```

Servidor padrão: `http://localhost:3000`

## Variáveis principais

- `HOST`: host do Fastify. Default `0.0.0.0`.
- `PORT`: porta HTTP. Default `3000`.
- `APP_BIND_ADDRESS` e `APP_PORT`: bind/porta do serviço no `docker compose`.
- `AUTH_BOOTSTRAP_BIND_ADDRESS` e `NOVNC_PORT`: bind/porta do `noVNC` no `docker compose`.
- `HEADLESS`: executa o Chromium em headless. Default `true`.
- `CAPTURE_TIMEOUT_MS`: timeout total por captura. Default `120000`.
- `MAX_CONCURRENT_CAPTURES`: capturas simultâneas. Default `1`.
- `VIEWPORT_WIDTH` e `VIEWPORT_HEIGHT`: resolução fixa da viewport. Defaults `1920x1080`.
- `USER_AGENT`: user-agent desktop usado no browser.
- `CHROME_USER_DATA_DIR`: diretório do perfil persistente do Chrome usado no bootstrap manual. Default `.auth/chrome-user-data`.
- `GOOGLE_STORAGE_STATE_PATH`: caminho do storage state reutilizado pelo Playwright.
- `GOOGLE_EMAIL` e `GOOGLE_PASSWORD`: credenciais usadas apenas pelo script de login.
- `GOOGLE_AUTH_HEADLESS`: define se o login Google roda em headless. Default `false`.
- `GOOGLE_AUTH_BROWSER_CHANNEL`: canal do navegador usado no login Google. Default `chrome`.
- `GOOGLE_AUTH_TIMEOUT_MS`: timeout do fluxo de login do Google. Default `180000`.

## YouTube autenticado

O fluxo recomendado é gerar uma sessão autenticada manualmente em um perfil persistente do Chrome e exportar o `storage state` para o serviço.

### Opção recomendada: bootstrap manual

```bash
pnpm auth:bootstrap
```

Esse comando:

- abre um Chrome real com perfil persistente em `CHROME_USER_DATA_DIR`
- espera você concluir o login manualmente
- exporta a sessão autenticada para `GOOGLE_STORAGE_STATE_PATH`

Depois disso, o serviço passa a reutilizar esse `storage state` automaticamente nas capturas.

### Opção alternativa: login automatizado

Se o Google aceitar a automação na sua máquina, você ainda pode tentar:

```bash
GOOGLE_EMAIL='seu-email@gmail.com' \
GOOGLE_PASSWORD='sua-senha' \
pnpm auth:google
```

Esse modo é menos confiável e pode ser bloqueado pelo Google com mensagens como `This browser or app may not be secure`.

Observações:

- Isso ajuda em vídeos públicos com prompt de login ou confirmação de idade.
- Isso não desbloqueia vídeos privados, members-only ou bloqueados por região.
- O arquivo `.auth/` fica fora do versionamento.
- O perfil persistente em `CHROME_USER_DATA_DIR` também fica fora do versionamento.

## Bootstrap em VPS sem interface

Se a aplicação vai rodar em uma VPS sem desktop, a forma mais estável é abrir uma interface remota temporária apenas para o login manual.

### Fluxo recomendado

1. Inicie um display virtual com `Xvfb`.
2. Exponha esse display com `x11vnc`.
3. Publique o acesso web com `noVNC`.
4. Rode `pnpm auth:bootstrap` na VPS.
5. Acesse a sessão remota pelo navegador, faça login no Google e conclua eventuais desafios.
6. Quando o script exportar `GOOGLE_STORAGE_STATE_PATH`, finalize `noVNC` e volte a rodar o serviço normalmente em headless.

### Exemplo de comando na VPS

```bash
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99

x11vnc -display :99 -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 &
/opt/novnc/utils/novnc_proxy --vnc 127.0.0.1:5900 --listen 6080 &

pnpm auth:bootstrap
```

Depois, crie um túnel SSH local:

```bash
ssh -L 6080:127.0.0.1:6080 usuario@sua-vps
```

Abra no seu navegador local:

```text
http://127.0.0.1:6080/vnc.html
```

Recomendações:

- Não exponha `noVNC` diretamente na internet sem proteção.
- Use uma conta Google dedicada ao serviço.
- Depois do bootstrap, rode o serviço normalmente com `HEADLESS=true`.
- Se a sessão expirar, execute `pnpm auth:bootstrap` novamente na mesma VPS.

## Docker Compose

O projeto inclui um [docker-compose.yml](/Volumes/Extreme SSD/Develop/gusta-screen/docker-compose.yml:1) com dois serviços:

- `app`: API em headless.
- `auth-bootstrap`: Chrome persistente + `Xvfb` + `x11vnc` + `noVNC` para login manual.

Os volumes `chrome-profile-data` e `auth-data` persistem o perfil do Chrome e o `storage state`.

### Subir a API

```bash
docker compose up -d app
```

### Fazer bootstrap manual da sessão Google

No host onde o Docker está rodando:

```bash
docker compose --profile auth up auth-bootstrap
```

Esse serviço:

- publica o `noVNC` em `AUTH_BOOTSTRAP_BIND_ADDRESS:NOVNC_PORT`
- abre um navegador persistente em `/data/chrome-user-data`
- espera o login manual
- exporta a sessão para `/data/auth/google-storage-state.json`

Dentro do container, o bootstrap usa o `chromium` empacotado pela imagem do Playwright, sem depender do Google Chrome instalado no host.

Se `AUTH_BOOTSTRAP_BIND_ADDRESS=127.0.0.1`, acesse por túnel SSH:

```bash
ssh -L 6080:127.0.0.1:6080 usuario@sua-vps
```

Depois abra:

```text
http://127.0.0.1:6080/vnc.html
```

Quando o bootstrap terminar, suba ou reinicie a API:

```bash
docker compose up -d app
```

### Exemplo para a VPS `89.117.33.99`

Na VPS:

```bash
docker compose --profile auth up auth-bootstrap
```

No seu computador local:

```bash
ssh -L 6080:127.0.0.1:6080 usuario@89.117.33.99
```

No navegador local:

```text
http://127.0.0.1:6080/vnc.html
```

Depois do login:

```bash
docker compose up -d app
```

## API

### `GET /health`

Resposta:

```json
{
  "status": "ok"
}
```

### `POST /api/screenshot`

Body:

```json
{
  "url": "https://www.youtube.com/watch?v=abc123"
}
```

Resposta de sucesso:

- Status `200`
- `Content-Type: image/png`
- Header `X-Provider: youtube|twitch`
- Header `X-Ad-Wait-Ms: <tempo-em-ms>`

Exemplo com `curl`:

```bash
curl -X POST http://localhost:3000/api/screenshot \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=abc123"}' \
  --output screenshot.png \
  -D -
```

Erros padronizados:

- `400`: body inválido
- `422`: URL ou conteúdo não suportado
- `500`: falha de navegação, player ou fullscreen
- `504`: anúncio não terminou antes do timeout

Exemplo de erro:

```json
{
  "error": {
    "code": "ad_timeout",
    "message": "Timed out while waiting for twitch advertisement to finish.",
    "details": {
      "provider": "twitch",
      "waitedMs": 1800
    }
  }
}
```

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm check
pnpm auth:bootstrap
pnpm auth:google
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:smoke
docker compose up -d app
docker compose --profile auth up auth-bootstrap
```

## Smoke tests reais

Os smoke tests são opcionais e só rodam se você informar uma URL real via env:

```bash
SMOKE_YOUTUBE_URL='https://www.youtube.com/watch?v=...' pnpm test:smoke
SMOKE_TWITCH_URL='https://www.twitch.tv/videos/...' pnpm test:smoke
```

## Docker

Build:

```bash
docker build -t gusta-screen .
```

Run:

```bash
docker run --rm -p 3000:3000 --env-file .env gusta-screen
```

O `Dockerfile` usa a imagem oficial do Playwright compatível com `playwright@1.61.1`.
