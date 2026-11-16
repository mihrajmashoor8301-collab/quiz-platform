import { normalizeQuestions } from "../durable-objects/quiz-room-core.js";
import { authenticateHost, HttpError, jsonResponse, readJson, supabaseRest } from "./supabase.js";
import { handleQuestionBankRequest } from "./question-banks.js";

function getRoomStub(env, pin) {
  const id = env.ROOMS.idFromName(pin);
  return env.ROOMS.get(id);
}

async function rateLimit(env, key, limit, windowMs) {
  const stub = getRoomStub(env, `rate:${key}`);
  const response = await stub.fetch("https://rate-limit.internal/__rate-limit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, limit, windowMs }),
  });
  if (!response.ok) throw new HttpError(429, "Too many requests. Try again shortly.");
}

async function parseSavedQuiz(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "My Live Quiz";
  const maxParticipants = Number(body.maxParticipants ?? 50);
  const globalTimeLimit = Number(body.globalTimeLimit ?? 20);
  if (title.length < 3 || title.length > 100) throw new HttpError(400, "Quiz title must be 3 to 100 characters.");
  if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 200) {
    throw new HttpError(400, "Participant limit must be from 1 to 200.");
  }
  if (!Number.isInteger(globalTimeLimit) || globalTimeLimit < 5 || globalTimeLimit > 120) {
    throw new HttpError(400, "Default timer must be from 5 to 120 seconds.");
  }
  if (!Array.isArray(body.questions) || body.questions.length > 50) {
    throw new HttpError(400, "Quiz questions must be an array with at most 50 entries.");
  }
  let questions = [];
  if (body.questions.length) {
    try { questions = normalizeQuestions(body.questions); }
    catch (error) { throw new HttpError(400, error.message); }
  }
  return { title, maxParticipants, globalTimeLimit, questions };
}

async function handleSavedQuiz(request, env, user) {
  if (request.method === "GET") {
    const rows = await supabaseRest(env,
      `quizzes?owner_id=eq.${encodeURIComponent(user.id)}&select=id,title,max_participants,global_time_limit,questions,updated_at&limit=1`
    );
    const row = rows?.[0];
    return jsonResponse(row ? {
      id: row.id,
      title: row.title,
      maxParticipants: row.max_participants,
      globalTimeLimit: row.global_time_limit,
      questions: row.questions.map((question) => {
        const metadata = { ...question };
        delete metadata.id;
        delete metadata.question;
        delete metadata.text;
        return {
          ...metadata,
          question: question.question ?? question.text,
          options: question.options,
          correct: question.correct,
          timeLimit: question.timeLimit,
        };
      }),
      updatedAt: row.updated_at,
    } : { title: "My Live Quiz", maxParticipants: 50, globalTimeLimit: 20, questions: [] });
  }
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  await rateLimit(env, `host:${user.id}`, 30, 60_000);
  const body = await readJson(request);
  const quiz = await parseSavedQuiz(body);
  const rows = await supabaseRest(env, "quizzes?on_conflict=owner_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      owner_id: user.id,
      title: quiz.title,
      max_participants: quiz.maxParticipants,
      global_time_limit: quiz.globalTimeLimit,
      questions: quiz.questions.map((question) => {
        const metadata = { ...question };
        delete metadata.id;
        delete metadata.question;
        delete metadata.text;
        return {
          ...metadata,
          question: question.question ?? question.text,
          options: question.options,
          correct: question.correct,
          timeLimit: question.timeLimit,
        };
      }),
      updated_at: new Date().toISOString(),
    }),
  });
  const row = rows?.[0];
  return jsonResponse(row ? {
    id: row.id,
    title: row.title,
    maxParticipants: row.max_participants,
    globalTimeLimit: row.global_time_limit,
    questions: row.questions,
    updatedAt: row.updated_at,
  } : { ...quiz, updatedAt: new Date().toISOString() });
}

async function handleCreateRoom(request, env, user) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  await rateLimit(env, `host:${user.id}`, 5, 60 * 60_000);
  const body = await readJson(request);
  const rows = await supabaseRest(env,
    `quizzes?owner_id=eq.${encodeURIComponent(user.id)}&select=id,title,max_participants,questions&limit=1`
  );
  const quiz = rows?.[0];
  if (!quiz) return jsonResponse({ error: "Save a quiz before creating a room." }, 400);
  let questions;
  try { questions = normalizeQuestions(quiz.questions); }
  catch (error) { return jsonResponse({ error: error.message }, 400); }

  const title = typeof body.title === "string" ? body.title.trim() : quiz.title;
  const maxParticipants = Number(body.maxParticipants ?? quiz.max_participants);
  if (title.length < 3 || title.length > 100) return jsonResponse({ error: "Room title must be 3 to 100 characters." }, 400);
  if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 200) {
    return jsonResponse({ error: "Participant limit must be from 1 to 200." }, 400);
  }

  let room;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    try {
      const created = await supabaseRest(env, "rooms", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          pin,
          quiz_id: quiz.id,
          host_id: user.id,
          title,
          max_participants: maxParticipants,
          status: "lobby",
        }),
      });
      room = created?.[0];
      if (room) break;
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
  if (!room) throw new HttpError(503, "Could not reserve a unique room PIN. Try again.");

  const stub = getRoomStub(env, room.pin);
  const initialized = await stub.fetch("https://room.internal/internal/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      room: {
        pin: room.pin,
        quizId: quiz.id,
        hostId: user.id,
        title: room.title,
        maxParticipants: room.max_participants,
      },
      questions,
    }),
  });
  if (!initialized.ok) {
    await supabaseRest(env, `rooms?pin=eq.${room.pin}`, { method: "DELETE" }).catch(() => {});
    throw new HttpError(503, "Could not initialize the multiplayer room.");
  }
  return jsonResponse({
    id: room.pin,
    pin: room.pin,
    title: room.title,
    status: room.status,
    maxParticipants: room.max_participants,
    currentParticipants: 0,
  }, 201);
}

function proxyRequest(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: "GET, POST, PATCH, DELETE, OPTIONS" } });
  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({ status: "ok", service: "quiz-platform-worker" });
  }
  if (url.pathname === "/api/config" && request.method === "GET") {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return jsonResponse({ error: "Supabase Auth is not configured." }, 503);
    return jsonResponse({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY });
  }
  if (url.pathname === "/api/network-info" && request.method === "GET") {
    return jsonResponse({ primaryIp: url.hostname, wifiUrl: url.origin });
  }

  if (url.pathname === "/api/saved-quiz") {
    const user = await authenticateHost(request, env);
    return handleSavedQuiz(request, env, user);
  }
  if (url.pathname === "/api/rooms") {
    const user = await authenticateHost(request, env);
    return handleCreateRoom(request, env, user);
  }
  if (url.pathname === "/api/question-banks" || url.pathname.startsWith("/api/question-banks/")) {
    const user = await authenticateHost(request, env);
    return handleQuestionBankRequest(request, env, user, (key, limit, windowMs) => rateLimit(env, key, limit, windowMs));
  }

  const roomMatch = /^\/api\/rooms\/([0-9]{6})(?:\/(join|questions|ws))?$/.exec(url.pathname);
  if (!roomMatch) return jsonResponse({ error: "Not found." }, 404);
  const [, pin, action] = roomMatch;
  const stub = getRoomStub(env, pin);

  if (action === "ws") {
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "WebSocket upgrade required." }, 426);
    }
    return stub.fetch(request);
  }
  if (!action && request.method === "GET") {
    await rateLimit(env, `lookup:${request.headers.get("cf-connecting-ip") || "local"}`, 300, 60_000);
    return stub.fetch(proxyRequest("https://room.internal/room", "GET"));
  }
  if (action === "join" && request.method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "local";
    await rateLimit(env, `join:${ip}`, 300, 60_000);
    return stub.fetch(proxyRequest("https://room.internal/join", "POST", await readJson(request), {
      "x-forwarded-client-ip": ip,
    }));
  }
  if (action === "questions" && request.method === "POST") {
    const user = await authenticateHost(request, env);
    return stub.fetch(proxyRequest("https://room.internal/questions", "POST", await readJson(request), {
      "x-authenticated-user-id": user.id,
    }));
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

export { parseSavedQuiz, getRoomStub };
