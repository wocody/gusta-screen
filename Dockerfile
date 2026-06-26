FROM mcr.microsoft.com/playwright:v1.61.1-noble AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod

FROM base AS runtime-base

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/auth-bootstrap-entrypoint.sh /usr/local/bin/auth-bootstrap-entrypoint

RUN chmod +x /usr/local/bin/auth-bootstrap-entrypoint

FROM runtime-base AS runtime

EXPOSE 3000

CMD ["pnpm", "start"]

FROM runtime-base AS auth-runtime

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    fluxbox \
    novnc \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 6080

CMD ["auth-bootstrap-entrypoint"]
