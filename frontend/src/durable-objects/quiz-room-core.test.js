import { describe, expect, it, vi } from "vitest";
import { authenticateHost, HttpError } from "../worker/supabase.js";
import { handleApiRequest } from "../worker/api.js";
import { createRoomState, QuizRoomCore } from "./quiz-room-core.js";

const room = {
  pin: "048219",
  quizId: "quiz-1",
  hostId: "a5e7eb32-df63-4c7f-8de8-b8f540bc854c",
  title: "Science night",
  maxParticipants: 2,
};
const questions = [{
  question: "What is H2O?",
  options: ["Water", "Air"],
  correct: "Water",
  timeLimit: 20,
}];

describe("Cloudflare quiz room core", () => {
  it("creates an authenticated room through the Worker API and initializes its Durable Object", async () => {
    const initialized = [];
    const env = {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "public-key",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
      ROOMS: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (url, init = {}) => {
            const path = new URL(url).pathname;
            if (path === "/__rate-limit") return Response.json({ allowed: true });
            if (path === "/internal/init") {
              initialized.push({ id, body: JSON.parse(init.body) });
              return Response.json({ status: "lobby" }, { status: 201 });
            }
            throw new Error(`Unexpected Durable Object route: ${path}`);
          },
        }),
      },
    };
    const fetchMock = vi.fn(async (url, init = {}) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === "/auth/v1/user") return Response.json({ id: room.hostId });
      if (parsedUrl.pathname === "/rest/v1/quizzes") {
        return Response.json([{ id: "quiz-1", title: room.title, max_participants: 2, questions }]);
      }
      if (parsedUrl.pathname === "/rest/v1/rooms" && init.method === "POST") {
        const created = JSON.parse(init.body);
        return Response.json([{ ...created }], { status: 201 });
      }
      throw new Error(`Unexpected Supabase request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleApiRequest(new Request("https://app.test/api/rooms", {
      method: "POST",
      headers: { authorization: "Bearer valid-access-token-123456", "content-type": "application/json" },
      body: JSON.stringify({ title: room.title, maxParticipants: room.maxParticipants }),
    }), env);
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.pin).toMatch(/^\d{6}$/);
    expect(result).toMatchObject({ title: room.title, status: "lobby", currentParticipants: 0 });
    expect(initialized).toHaveLength(1);
    expect(initialized[0].id).toBe(result.pin);
    expect(initialized[0].body).toMatchObject({
      room: { pin: result.pin, hostId: room.hostId },
      questions: [{ text: questions[0].question, correct: questions[0].correct }],
    });
  });

  it("validates and creates a room with a private answer key", () => {
    const state = createRoomState(room, questions, 1000);
    expect(state).toMatchObject({ pin: room.pin, hostId: room.hostId, questionState: "lobby", players: [] });
    expect(state.questions[0].correct).toBe("Water");
    expect(() => createRoomState(room, [{ ...questions[0], correct: "Fire" }])).toThrow(/correct answer/);
    expect(() => createRoomState({ ...room, pin: "bad" }, questions)).toThrow(/identity/);
  });

  it("verifies Supabase Auth sessions and rejects missing or invalid host tokens", async () => {
    const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-key" };
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers.authorization).toBe("Bearer valid-access-token-123456");
      return Response.json({ id: room.hostId, email: "host@example.test" });
    });
    const user = await authenticateHost(new Request("https://app.test/api/rooms", {
      headers: { authorization: "Bearer valid-access-token-123456" },
    }), env, fetchImpl);
    expect(user).toEqual({ id: room.hostId, email: "host@example.test" });
    await expect(authenticateHost(new Request("https://app.test/api/rooms"), env, fetchImpl))
      .rejects.toMatchObject({ status: 401 });
    await expect(authenticateHost(new Request("https://app.test/api/rooms", {
      headers: { authorization: "Bearer expired-access-token-123456" },
    }), env, async () => new Response("{}", { status: 401 })))
      .rejects.toMatchObject({ status: 401 });
    expect(HttpError).toBeDefined();
  });

  it("validates nicknames, preserves player sessions, and enforces room capacity", () => {
    const core = new QuizRoomCore(createRoomState(room, questions));
    const first = core.addPlayer({ id: "player-1", nickname: "  Ada   Lovelace ", sessionHash: "hash-1" });
    expect(first.nickname).toBe("Ada Lovelace");
    expect(core.addPlayer({ id: "player-1", nickname: "Ada Lovelace", sessionHash: "hash-1" })).toBe(first);
    core.addPlayer({ id: "player-2", nickname: "Grace", sessionHash: "hash-2" });
    expect(() => core.addPlayer({ id: "player-3", nickname: "Lin", sessionHash: "hash-3" })).toThrow(/full/);
    expect(() => core.addPlayer({ id: "player-4", nickname: "ada lovelace", sessionHash: "hash-4" })).toThrow(/already in use/);
    expect(() => core.addPlayer({ id: "player-5", nickname: "x", sessionHash: "hash-5" })).toThrow(/2 to 20/);
    expect(core.joinPlayer("player-1")[0].data.participant).not.toHaveProperty("sessionHash");
  });

  it("authorizes hosts, keeps the answer key private during questions, and reveals it after close", () => {
    const core = new QuizRoomCore(createRoomState(room, questions), () => 1000);
    core.addPlayer({ id: "player-1", nickname: "Ada", sessionHash: "secret" });
    core.addPlayer({ id: "player-2", nickname: "Grace", sessionHash: "secret-2" });
    expect(() => core.startQuiz("attacker")).toThrow(/authorization/);
    core.startQuiz(room.hostId);
    const playerQuestion = core.currentQuestionPayload();
    expect(playerQuestion.options).toEqual(["Water", "Air"]);
    expect(playerQuestion).not.toHaveProperty("correct");
    const hostEvents = core.joinHost(room.hostId);
    expect(hostEvents[0].data.questions[0].correct).toBe("Water");
    expect(() => core.joinHost("attacker")).toThrow(/authorization/);
    core.submitAnswer("player-1", { questionId: 1, answer: "Water" });
    const results = core.closeEarly(room.hostId)[0].data;
    expect(results.correctAnswers).toEqual(["Water"]);
  });

  it("rejects invalid, stale, and duplicate answer submissions", () => {
    let now = 1000;
    const core = new QuizRoomCore(createRoomState(room, questions), () => now);
    core.addPlayer({ id: "player-1", nickname: "Ada", sessionHash: "secret" });
    core.addPlayer({ id: "player-2", nickname: "Grace", sessionHash: "secret-2" });
    core.startQuiz(room.hostId);
    expect(() => core.submitAnswer("missing", { questionId: 1, answer: "Water" })).toThrow(/session/);
    expect(() => core.submitAnswer("player-1", { questionId: 2, answer: "Water" })).toThrow(/Question id/);
    expect(() => core.submitAnswer("player-1", { questionId: 1, answer: "Fire" })).toThrow(/available options/);
    core.submitAnswer("player-1", { questionId: 1, answer: "Water" });
    expect(() => core.submitAnswer("player-1", { questionId: 1, answer: "Water" })).toThrow(/already answered/);
    now += 20_000;
    expect(() => core.submitAnswer("player-1", { questionId: 1, answer: "Water" })).toThrow(/closed/);
  });

  it("scores each correct response using its own remaining-time speed bonus", () => {
    let now = 10_000;
    const state = createRoomState(room, questions);
    const core = new QuizRoomCore(state, () => now);
    core.addPlayer({ id: "fast", nickname: "Fast", sessionHash: "a" });
    core.addPlayer({ id: "slow", nickname: "Slow", sessionHash: "b" });
    core.startQuiz(room.hostId);
    now = 11_000;
    core.submitAnswer("fast", { questionId: 1, answer: "Water" });
    now = 20_000;
    const events = core.submitAnswer("slow", { questionId: 1, answer: "Water" });
    const results = events.find((event) => event.event === "question-results").data;
    expect(results.leaderboard.map(({ id, score }) => [id, score])).toEqual([["fast", 1285], ["slow", 1150]]);
    expect(results.optionCounts.Water).toBe(2);
    expect(state.rounds[0].answers).toHaveLength(2);
  });

  it("closes on the Durable Object alarm and advances or finishes the quiz", () => {
    let now = 0;
    const core = new QuizRoomCore(createRoomState(room, questions), () => now);
    core.addPlayer({ id: "player-1", nickname: "Ada", sessionHash: "hash" });
    core.startQuiz(room.hostId);
    expect(core.onAlarm(19_999)).toEqual([]);
    now = 20_000;
    const result = core.onAlarm(now);
    expect(result[0].event).toBe("question-results");
    expect(core.state.questionState).toBe("results");
    expect(core.state.players[0].isCorrect).toBe(false);
    expect(core.nextQuestion(room.hostId)[0].event).toBe("quiz-finished");
    expect(core.state.questionState).toBe("finished");
  });

  it("broadcasts multiplayer lobby updates and closes when all players answer", () => {
    let now = 5000;
    const core = new QuizRoomCore(createRoomState(room, questions), () => now);
    core.addPlayer({ id: "player-1", nickname: "Ada", sessionHash: "a" });
    core.addPlayer({ id: "player-2", nickname: "Grace", sessionHash: "b" });
    const joined = core.joinPlayer("player-2");
    expect(joined.some((event) => event.audience === "room" && event.event === "player-list" && event.data.count === 2)).toBe(true);
    core.startQuiz(room.hostId);
    const first = core.submitAnswer("player-1", { questionId: 1, answer: "Water" });
    expect(first.some((event) => event.event === "question-results")).toBe(false);
    now += 1000;
    const last = core.submitAnswer("player-2", { questionId: 1, answer: "Air" });
    expect(last.some((event) => event.audience === "host" && event.event === "answer-stats" && event.data.answered === 2)).toBe(true);
    expect(last.find((event) => event.event === "question-results").data.leaderboard).toHaveLength(2);
  });

  it("allows host to cancel an ongoing quiz and notifies players", () => {
    const core = new QuizRoomCore(createRoomState(room, questions), () => 1000);
    core.addPlayer({ id: "player-1", nickname: "Ada", sessionHash: "a" });
    core.startQuiz(room.hostId);
    expect(core.state.questionState).toBe("question");

    // Host cancels quiz
    const cancelEvents = core.cancelQuiz(room.hostId);
    expect(cancelEvents).toEqual([
      { audience: "room", event: "quiz-cancelled", data: { message: "The host has ended this quiz session." } },
    ]);
    expect(core.state.status).toBe("cancelled");
    expect(core.state.questionState).toBe("cancelled");
    expect(core.state.deadline).toBeNull();

    // Re-joining player receives quiz-cancelled event
    const joinEvents = core.joinPlayer("player-1");
    expect(joinEvents.some((e) => e.event === "quiz-cancelled")).toBe(true);
  });

  it("allows host to finish an ongoing quiz early and calculates final standings", () => {
    const core = new QuizRoomCore(createRoomState(room, questions), () => 1000);
    core.addPlayer({ id: "player-1", nickname: "Ada", sessionHash: "a" });
    core.startQuiz(room.hostId);
    core.submitAnswer("player-1", { questionId: 1, answer: "Water" });

    // Host ends quiz early during question
    const finishEvents = core.finishQuiz(room.hostId);
    expect(core.state.status).toBe("finished");
    expect(core.state.questionState).toBe("finished");
    expect(finishEvents.some((e) => e.event === "quiz-finished")).toBe(true);
    expect(core.state.finalLeaderboard).toHaveLength(1);
    expect(core.state.finalLeaderboard[0].nickname).toBe("Ada");
  });
});
