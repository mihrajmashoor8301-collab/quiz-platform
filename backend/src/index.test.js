// Boot-time integration probe: starts the real HTTP server, mounts Socket.IO,
// creates a room over HTTP and joins it through a real socket.io-client.
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { io } from "socket.io-client";

import { setup, start } from "./index.js";

expect.extend({
  toBeOK(received) {
    const pass = received && (received.ok === true || received.status === 200);
    return {
      pass,
      message: () => (pass ? "expected response not to be OK" : "expected response to be OK"),
    };
  },
});

const address = start();
// `start()` returns the recorded address; `setup()` boots the server on the
// configured HTTP_PORT, so the probe connects to that port. The test process
// is the only consumer, so fail loudly if the server ever binds beyond
// loopback.
const httpServerAddress = address;
if (httpServerAddress && httpServerAddress.address !== "127.0.0.1") {
  throw new Error("HTTP server bound to " + httpServerAddress.address);
}
const port = Number(process.env.HTTP_PORT || httpServerAddress.port);
const release = [];

let sharedGuest = null;
const joinGuest = (pin) =>
  new Promise((resolve, reject) => {
    if (!sharedGuest) {
      sharedGuest = io("http://127.0.0.1:" + port, { transports: ["websocket"] });
      release.push(() => {
        sharedGuest.close();
        sharedGuest = null;
      });
    }
    const onJoin = () => {
      sharedGuest.emit("join:room", { pin, nickname: "guest-" + uuidv4().slice(0, 6) }, (err) =>
        resolve(err ? "rejected: " + err : "joined")
      );
    };
    if (sharedGuest.connected) {
      onJoin();
    } else {
      sharedGuest.once("connect", onJoin);
    }
    sharedGuest.on("connect_error", (e) => reject(new Error(e.message)));
  });

describe("backend boot", { timeout: 20000 }, () => {
  beforeAll(async () => {
    await setup();
  });

  afterAll(() => {
    release.forEach((c) => c());
    release.length = 0;
  });

  it("answers /health", async () => {
    const res = await fetch("http://127.0.0.1:" + port + "/health");
    expect(res).toBeOK();
  });

  it("creates a room over HTTP and a guest joins via Socket.IO", async () => {
    const room = await fetch("http://127.0.0.1:" + port + "/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Boot room", maxParticipants: 200 }),
    });
    const body = await room.json();
    expect(room.status).toBe(201);
    expect(body.pin).toHaveLength(6);

    expect(await joinGuest(body.pin)).toBe("joined");

    // A second join on the same socket is refused: the client must leave
    // first, so reconnects can be tracked by pid.
    const duplicate = await joinGuest(body.pin);
    expect(duplicate).not.toBe("joined");
    expect(duplicate).toMatch(/already in a room|already joined/);
  });
});
