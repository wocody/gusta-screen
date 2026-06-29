# gusta-screen

Serviço HTTP em `Node.js + Fastify + Playwright` que recebe uma URL pública de YouTube ou Twitch e devolve uma imagem PNG.

## O que o serviço faz

- YouTube: usa a API externa [YouTube Thumbnail & Screenshots API](https://rapidapi.com/mahmudulhasandev/api/youtube-thumbnail-screenshots-api) para obter uma imagem do vídeo e a renderiza como `image/png`.
- Twitch: continua usando Playwright para abrir o player, entrar em fullscreen, aguardar anúncio terminar e capturar a viewport.
- Responde sempre de forma síncrona em `POST /api/screenshot`.

## Comportamento por provider

- `youtube`: aceita URLs `watch` e `/live/<video-id>`. O serviço consulta o RapidAPI, escolhe a melhor screenshot disponível e usa thumbnail como fallback. `X-Ad-Wait-Ms` sempre será `0`.
- `twitch`: aceita canal público ao vivo e VOD público. Mantém a lógica atual de autoplay, fullscreen e espera de anúncio.

## Fora de escopo do v1

- Login Google ou qualquer sessão autenticada.
- YouTube Shorts, Twitch Clips e formatos fora do padrão.
- Filas assíncronas, armazenamento de screenshots e autenticação da API.

## Requisitos

- Node `22+`
- `pnpm`
- Chromium do Playwright instalado localmente
- Chave `RapidAPI` para capturas de YouTube

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
- `YOUTUBE_RAPIDAPI_KEY`: chave da API externa usada nas capturas de YouTube.
- `YOUTUBE_RAPIDAPI_HOST`: host RapidAPI do provider. Default `youtube-thumbnail-screenshots-api.p.rapidapi.com`.
- `YOUTUBE_RAPIDAPI_BASE_URL`: base URL do provider. Default `https://youtube-thumbnail-screenshots-api.p.rapidapi.com`.

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
- `500`: falha de captura local ou da integração externa
- `504`: anúncio da Twitch não terminou antes do timeout

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

O compose já força `HEADLESS=true` e `PRETTY_LOGS=false`. Para capturas de YouTube, exporte a chave antes de subir:

```bash
export YOUTUBE_RAPIDAPI_KEY='sua-chave'
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
YOUTUBE_RAPIDAPI_KEY='sua-chave' \
SMOKE_YOUTUBE_URL='https://www.youtube.com/watch?v=...' \
pnpm test:smoke

SMOKE_TWITCH_URL='https://www.twitch.tv/videos/...' \
pnpm test:smoke
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
