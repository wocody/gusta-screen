# gusta-screen

Serviço HTTP em `Node.js + Fastify + Playwright` que recebe uma URL pública da Twitch e devolve uma screenshot PNG do player em fullscreen.

## O que o serviço faz

- Aceita canal ao vivo e VOD públicos da Twitch.
- Abre o player com Playwright.
- Resolve consent/gates simples.
- Inicia a reprodução quando necessário.
- Entra em fullscreen pelo player.
- Aguarda anúncio terminar antes de capturar.
- Responde de forma síncrona em `POST /api/screenshot`.

## Fora de escopo do v1

- Qualquer provider diferente de Twitch.
- Conteúdo privado, com login obrigatório, geoblock ou DRM.
- Twitch Clips e formatos fora do padrão.
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
- `HEADLESS`: executa o Chromium em headless. Default `true`.
- `CAPTURE_TIMEOUT_MS`: timeout total por captura. Default `120000`.
- `MAX_CONCURRENT_CAPTURES`: capturas simultâneas. Default `1`.
- `VIEWPORT_WIDTH` e `VIEWPORT_HEIGHT`: resolução fixa da viewport. Defaults `1920x1080`.
- `USER_AGENT`: user-agent desktop usado no browser.
- `TWITCH_ALLOWED_HOSTS`: lista de hosts aceitos para Twitch.
- `PRETTY_LOGS`: quando `false`, emite logs JSON no `stdout`, ideal para o console em tempo real do EasyPanel.

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
  "url": "https://www.twitch.tv/videos/123456789"
}
```

Resposta de sucesso:

- Status `200`
- `Content-Type: image/png`
- Header `X-Provider: twitch`
- Header `X-Ad-Wait-Ms: <tempo-em-ms>`

Exemplo com `curl`:

```bash
curl -X POST http://localhost:3000/api/screenshot \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.twitch.tv/videos/123456789"}' \
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

## Docker Compose

O projeto inclui um [docker-compose.yml](/Volumes/Extreme SSD/Develop/gusta-screen/docker-compose.yml:1) com um único serviço `app`.

Subir a API:

```bash
docker compose up -d app
```

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm check
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:smoke
docker compose up -d app
```

## Smoke tests reais

Os smoke tests são opcionais:

```bash
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

## Logs

Todos os logs da API e da captura saem no `stdout`, então ficam visíveis no console em tempo real do EasyPanel.

Etapas principais logadas por requisição:

- `http:request_started` e `http:request_completed`
- `capture:queue_wait`, `capture:slot_acquired` e `capture:complete`
- `capture:navigation_complete`
- `twitch:playback_*`
- `twitch:fullscreen_*`
- `twitch:ad_detected`, `twitch:ad_clear` e `twitch:ad_timeout`

Para produção no EasyPanel, prefira `PRETTY_LOGS=false` para manter logs estruturados em JSON.
