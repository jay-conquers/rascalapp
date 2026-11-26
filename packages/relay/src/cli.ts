import { startRelay } from "./server.ts";

const secret = process.env.RELAY_SECRET ?? "";
const port = Number(process.env.RELAY_PORT ?? "8790");
const host = process.env.RELAY_BIND ?? "0.0.0.0";
const publicKeyPem = process.env.KICK_PUBLIC_KEY_PEM;
const publicKeyUrl = process.env.KICK_PUBLIC_KEY_URL;

if (secret.trim().length < 16) {
  console.error("Set RELAY_SECRET to a random string of at least 16 characters.");
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("RELAY_PORT must be a port number.");
  process.exit(1);
}

startRelay({
  secret,
  port,
  host,
  publicKeyPem: publicKeyPem?.trim() ? publicKeyPem : undefined,
  publicKeyUrl: publicKeyUrl?.trim() || undefined,
})
  .then((relay) => {
    console.log(`relay listening on ${host}:${relay.port}`);
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "relay failed to start");
    process.exit(1);
  });
