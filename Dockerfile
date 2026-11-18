# Self-hosted board: build once, run the Nitro server. Data lives in /data (a volume), never in the image.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NITRO_PORT=3000 NITRO_HOST=0.0.0.0
COPY --from=build /app/.output ./.output
VOLUME /data
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
