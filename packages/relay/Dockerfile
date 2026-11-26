FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN npm install -g esbuild@0.28.2
COPY packages/relay /src/packages/relay
COPY src/shared /src/src/shared
RUN esbuild packages/relay/src/cli.ts --bundle --platform=node --target=node22 --format=cjs --outfile=/src/relay.cjs

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /src/relay.cjs /app/relay.cjs
ENV RELAY_BIND=0.0.0.0
ENV RELAY_PORT=8790
USER node
EXPOSE 8790
LABEL org.opencontainers.image.title="Relay"
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "const port=process.env.RELAY_PORT||8790;fetch('http://127.0.0.1:'+port+'/healthz').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/relay.cjs"]
