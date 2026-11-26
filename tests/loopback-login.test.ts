import net from "node:net";
import { describe, expect, it } from "vitest";
import { KickConnection } from "../src/shared/kick/connection";
import { KICK_OAUTH_PORT } from "../src/shared/kick/oauth";
import { waitForLoopbackCode } from "../src/shared/loopback-login";

const copy = {
  title: "Kick",
  granted: "Kick is connected. You can close this window.",
  denied: "Kick did not grant access. You can close this window.",
  cancelled: "The Kick login was cancelled.",
  timedOut: "The Kick login timed out. Start it again.",
  busy: "Kick login is already waiting. Finish that one or cancel it.",
};

describe("loopback login", () => {
  it("ignores a callback with the wrong state and accepts it on both loopback addresses", async () => {
    const port = await freePort();
    const state = "a".repeat(32);
    let listening = false;
    const pending = waitForLoopbackCode({
      ...copy,
      port,
      path: "/kick/callback",
      expectedState: state,
      onListening: () => {
        listening = true;
      },
    });
    await waitFor(() => listening);
    const wrong = await fetch(`http://127.0.0.1:${port}/kick/callback?error=access_denied`);
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).not.toContain("access_denied");
    const v6 = await fetch(`http://[::1]:${port}/kick/callback?code=from-v6&state=${state}`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (v6) {
      expect(v6.status).toBe(200);
      expect(await v6.text()).toContain("Kick is connected");
      await expect(pending).resolves.toEqual({ code: "from-v6", state });
      return;
    }
    const v4 = await fetch(`http://127.0.0.1:${port}/kick/callback?code=from-v4&state=${state}`);
    expect(v4.status).toBe(200);
    await expect(pending).resolves.toEqual({ code: "from-v4", state });
  });

  it("stops listening when the login times out or is cancelled", async () => {
    const timedPort = await freePort();
    await expect(
      waitForLoopbackCode({ ...copy, port: timedPort, path: "/kick/callback", expectedState: "state", timeoutMs: 30 }),
    ).rejects.toThrow(/timed out/);
    const again = await freePortProbe(timedPort);
    expect(again).toBe(true);

    const port = await freePort();
    const signal = new AbortController();
    const pending = waitForLoopbackCode({ ...copy, port, path: "/youtube/callback", expectedState: "state", signal: signal.signal });
    signal.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(await freePortProbe(port)).toBe(true);
  });

  it("opens the Kick browser after the callback port is accepting connections", async () => {
    let status = 0;
    const connection = new KickConnection({
      client: () => ({ clientId: "client12345", clientSecret: "secret-value" }),
      tokens: () => null,
      saveTokens: () => undefined,
      clearTokens: () => undefined,
      relayUrl: () => "",
      relaySecret: () => "",
      fetchImpl: async () => new Response("{}", { status: 500 }),
      onLoginUrl: () => {
        void fetch(`http://127.0.0.1:${KICK_OAUTH_PORT}/kick/callback?state=wrong`)
          .then((res) => {
            status = res.status;
          })
          .catch(() => {
            status = -1;
          });
      },
    });
    const pending = connection.beginLogin();
    try {
      await waitFor(() => status !== 0);
      expect(status).toBe(400);
    } finally {
      connection.cancelLogin();
      await pending;
    }
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function freePortProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 3000) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
