import { DurableObject } from "cloudflare:workers";
import { createRoomState, QuizRoomCore } from "./quiz-room-core.js";
import { authenticateHost, jsonResponse, readJson, supabaseRest } from "../worker/supabase.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function digestToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(body, status = 200) {
  return jsonResponse(body, status);
}

export class QuizRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.lock = Promise.resolve();
  }

  async withLock(callback) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await callback(); }
    finally { release(); }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__rate-limit" && request.method === "POST") return this.rateLimit(request);
    if (url.pathname === "/internal/init" && request.method === "POST") return this.initialize(request);
    if (url.pathname === "/room" && request.method === "GET") return this.getRoom();
    if (url.pathname === "/join" && request.method === "POST") return this.joinPlayer(request);
    if (url.pathname === "/questions" && request.method === "POST") return this.addQuestion(request);
    if (url.pathname.endsWith("/ws")) return this.openWebSocket(request);
    return response({ error: "Not found." }, 404);
  }

  async rateLimit(request) {
    const body = await readJson(request, 2048);
    const key = String(body.key || "").slice(0, 160);
    const limit = Math.min(1000, Math.max(1, Number(body.limit) || 1));
    const windowMs = Math.min(24 * 60 * 60_000, Math.max(1000, Number(body.windowMs) || 60_000));
    if (!key) return response({ error: "Rate limit key is required." }, 400);
    return this.withLock(async () => {
      const storageKey = `rate:${key}`;
      const now = Date.now();
      const previous = await this.ctx.storage.get(storageKey);
      const windowStart = previous && now - previous.startedAt < windowMs ? previous.startedAt : now;
      const count = previous && windowStart === previous.startedAt ? previous.count : 0;
      if (count >= limit) return response({ error: "Too many requests." }, 429);
      await this.ctx.storage.put(storageKey, { startedAt: windowStart, count: count + 1 });
      return response({ allowed: true });
    });
  }

  async initialize(request) {
    const body = await readJson(request);
    try {
      const state = createRoomState(body.room, body.questions);
      return this.withLock(async () => {
        const existing = await this.ctx.storage.get("room-state");
        if (existing && existing.hostId !== state.hostId) return response({ error: "Room already exists." }, 409);
        await this.ctx.storage.put("room-state", existing || state);
        return response({ pin: state.pin, status: "lobby" }, 201);
      });
    } catch (error) {
      return response({ error: error.message || "Invalid room." }, 400);
    }
  }

  async loadState() {
    const state = await this.ctx.storage.get("room-state");
    if (!state || state.version !== 1) return null;
    return state;
  }

  async saveState(state) {
    await this.ctx.storage.put("room-state", state);
  }

  core(state) {
    return new QuizRoomCore(state);
  }

  async getRoom() {
    const state = await this.loadState();
    if (!state) return response({ error: "Room not found." }, 404);
    return response({
      id: state.pin,
      pin: state.pin,
      title: state.title,
      status: state.status,
      currentParticipants: state.players.length,
      maxParticipants: state.maxParticipants,
      questionState: state.questionState,
    });
  }

  async joinPlayer(request) {
    return this.withLock(async () => {
      const state = await this.loadState();
      if (!state) return response({ error: "Room not found." }, 404);
      let body;
      try { body = await readJson(request, 4096); }
      catch (error) { return response({ error: error.message }, error.status || 400); }
      const playerId = String(body.playerId || "");
      const nickname = body.nickname;
      const sessionToken = String(body.sessionToken || "");
      if (!UUID_PATTERN.test(playerId) || !TOKEN_PATTERN.test(sessionToken)) {
        return response({ error: "Player session is invalid." }, 400);
      }
      const sessionHash = await digestToken(sessionToken);
      const core = this.core(state);
      const existing = state.players.find((player) => player.id === playerId);
      if (existing && existing.sessionHash !== sessionHash) return response({ error: "Player session is invalid." }, 401);
      let player;
      try { player = core.addPlayer({ id: playerId, nickname, sessionHash }); }
      catch (error) { return response({ error: error.message }, 400); }
      try {
        await supabaseRest(this.env, "room_participants?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ id: player.id, room_pin: state.pin, nickname: player.nickname, score: player.score }),
        });
      } catch {
        if (!existing) state.players = state.players.filter((item) => item.id !== player.id);
        return response({ error: "Could not save your player session. Please try again." }, 503);
      }
      await this.saveState(state);
      return response({
        playerId: player.id,
        sessionToken,
        participant: { id: player.id, nickname: player.nickname, score: player.score },
        state: state.questionState,
      }, existing ? 200 : 201);
    });
  }

  async addQuestion(request) {
    return this.withLock(async () => {
      const state = await this.loadState();
      if (!state) return response({ error: "Room not found." }, 404);
      const userId = request.headers.get("x-authenticated-user-id");
      const core = this.core(state);
      let question;
      try { question = core.addQuestion(userId, await readJson(request)); }
      catch (error) { return response({ error: error.message }, error.status || 400); }
      await this.saveState(state);
      return response(question, 201);
    });
  }

  async openWebSocket(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return response({ error: "Origin is not allowed." }, 403);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return response({ error: "WebSocket upgrade required." }, 426);
    }
    if (!(await this.loadState())) return response({ error: "Room not found." }, 404);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ joined: false });
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    return this.withLock(async () => {
      const attachment = socket.deserializeAttachment() || { joined: false };
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (text.length > 8192) return this.send(socket, "error", "Message is too large.");
      let packet;
      try { packet = JSON.parse(text); }
      catch { return this.send(socket, "error", "Message must be valid JSON."); }
      if (!packet || typeof packet.event !== "string") return this.send(socket, "error", "Message event is invalid.");
      const state = await this.loadState();
      if (!state) return this.send(socket, "error", "Room not found.");
      const core = this.core(state);

      if (!attachment.joined) {
        try {
          const identity = await this.authenticateSocket(packet, state);
          socket.serializeAttachment({ ...identity, joined: true });
          const events = identity.role === "host" ? core.joinHost(identity.userId) : core.joinPlayer(identity.playerId);
          this.publish(events);
          await this.saveState(state);
        } catch (error) {
          this.send(socket, "error", error.message || "Could not join room.");
          socket.close(1008, "Authentication failed");
        }
        return;
      }

      try {
        let events = [];
        if (packet.event === "submit-answer" && attachment.role === "player") {
          events = core.submitAnswer(attachment.playerId, packet.data || {});
        } else if (["start-quiz", "close-question", "next-question", "finish-quiz", "cancel-quiz"].includes(packet.event) && attachment.role === "host") {
          if (packet.event === "start-quiz") events = core.startQuiz(attachment.userId);
          if (packet.event === "close-question") events = core.closeEarly(attachment.userId);
          if (packet.event === "next-question") events = core.nextQuestion(attachment.userId);
          if (packet.event === "finish-quiz") events = core.finishQuiz(attachment.userId);
          if (packet.event === "cancel-quiz") events = core.cancelQuiz(attachment.userId);
        } else {
          throw new Error("This action is not allowed for this session.");
        }
        this.publish(events);
        await this.saveState(state);
        await this.syncAlarm(state);
        if (packet.event === "start-quiz") await this.setRoomStatus("running", true, state.pin);
        if (packet.event === "cancel-quiz") await this.setRoomStatus("cancelled", false, state.pin);
        if (state.questionState === "finished") await this.persistFinal(state);
      } catch (error) {
        this.send(socket, "error", error.message || "The action could not be completed.");
      }
    });
  }

  async authenticateSocket(packet, state) {
    const data = packet.data || {};
    const roomPin = String(data.roomPin || data.pin || "");
    if (roomPin !== state.pin) throw new Error("Invalid room PIN.");
    if (data.isHost === true) {
      const token = String(data.token || "");
      const request = new Request("https://quiz.internal/auth", { headers: { authorization: `Bearer ${token}` } });
      const user = await authenticateHost(request, this.env);
      if (user.id !== state.hostId) throw new Error("This account does not host this room.");
      return { role: "host", userId: user.id };
    }
    const playerId = String(data.playerId || "");
    const sessionToken = String(data.playerToken || "");
    if (!UUID_PATTERN.test(playerId) || !TOKEN_PATTERN.test(sessionToken)) throw new Error("Player session is invalid.");
    const player = state.players.find((item) => item.id === playerId);
    if (!player || player.sessionHash !== await digestToken(sessionToken)) throw new Error("Player session is invalid.");
    return { role: "player", playerId: player.id };
  }

  publish(events) {
    for (const item of events || []) {
      if (!item) continue;
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() || {};
        if (!attachment.joined) continue;
        const accepted = item.audience === "room"
          || (item.audience === "host" && attachment.role === "host")
          || (item.audience === `player:${attachment.playerId}` && attachment.role === "player");
        if (accepted) this.send(socket, item.event, item.data);
      }
    }
  }

  send(socket, event, data) {
    try {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, data }));
    } catch {}
  }

  async syncAlarm(state) {
    if (state.questionState === "question" && Number.isFinite(state.deadline)) {
      await this.ctx.storage.setAlarm(state.deadline);
    } else if (!state.resultPersistPending) {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm() {
    return this.withLock(async () => {
      const state = await this.loadState();
      if (!state) return;
      if (state.questionState === "question") {
        const events = this.core(state).onAlarm(Date.now());
        this.publish(events);
        await this.saveState(state);
        await this.syncAlarm(state);
      } else if (state.questionState === "finished" && state.resultPersistPending) {
        await this.persistFinal(state);
      }
    });
  }

  async setRoomStatus(status, start = false, pin) {
    const fields = { status };
    if (start) fields.started_at = new Date().toISOString();
    if (!pin) return;
    await supabaseRest(this.env, `rooms?pin=eq.${pin}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(fields),
    }).catch(() => {});
  }

  async persistFinal(state) {
    if (state.resultPersisted) return;
    if (!state.resultPersistPending && state.finalLeaderboard) {
      state.resultPersistPending = true;
      state.persistAttempts = 0;
    }
    if (!state.resultPersistPending) return;
    try {
      const players = state.players.map((player) => ({
        id: player.id,
        room_pin: state.pin,
        nickname: player.nickname,
        score: player.score,
      }));
      if (players.length) {
        await supabaseRest(this.env, "room_participants?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(players),
        });
      }
      const answers = state.rounds.flatMap((round) => round.answers.map((answer) => ({
        room_pin: state.pin,
        participant_id: answer.participantId,
        question_index: round.questionIndex,
        answer: answer.answer,
        is_correct: answer.isCorrect,
        score_awarded: answer.scoreAwarded,
        submitted_at: new Date(answer.submittedAt).toISOString(),
      })));
      if (answers.length) {
        await supabaseRest(this.env, "room_answers?on_conflict=room_pin,participant_id,question_index", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(answers),
        });
      }
      await supabaseRest(this.env, "quiz_results?on_conflict=room_pin", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          room_pin: state.pin,
          host_id: state.hostId,
          leaderboard: state.finalLeaderboard,
          rounds: state.rounds,
          completed_at: new Date().toISOString(),
        }),
      });
      await supabaseRest(this.env, `rooms?pin=eq.${state.pin}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "finished", finished_at: new Date().toISOString() }),
      });
      state.resultPersistPending = false;
      state.resultPersisted = true;
      await this.saveState(state);
      await this.ctx.storage.deleteAlarm();
    } catch (error) {
      state.resultPersistPending = true;
      state.persistAttempts = (state.persistAttempts || 0) + 1;
      await this.saveState(state);
      const delay = Math.min(5 * 60_000, 15_000 * (2 ** Math.min(4, state.persistAttempts - 1)));
      await this.ctx.storage.setAlarm(Date.now() + delay);
      console.error("Quiz result persistence failed; retry scheduled.", error?.status || "unknown");
    }
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch {}
  }
}
