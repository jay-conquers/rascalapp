FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN npm install -g esbuild@0.28.2
COPY packages/bot /src/packages/bot
COPY src /src/src
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
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "const port=process.env.RASCAL_BOT_PORT||4788;fetch('http://127.0.0.1:'+port+'/healthz').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bot.cjs"]
