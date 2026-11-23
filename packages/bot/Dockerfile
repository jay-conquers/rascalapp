FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN npm install -g esbuild@0.28.2
COPY packages/bot /src/packages/bot
COPY src/shared /src/src/shared
RUN esbuild packages/bot/src/cli.ts --bundle --platform=node --target=node22 --format=cjs --outfile=/src/bot.cjs

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /src/bot.cjs /app/bot.cjs
ENV RASCAL_BOT_DIR=/data
ENV RASCAL_BOT_BIND=0.0.0.0
ENV RASCAL_BOT_PORT=4788
LABEL org.opencontainers.image.title="Rascal bot"
VOLUME ["/data"]
EXPOSE 4788
CMD ["node", "bot.cjs"]
