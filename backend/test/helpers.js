// Test helpers: a fake backend container and seeds that mirror the service
// contracts, so both the service unit tests and the game loop tests share them.
import { v4 as uuidv4 } from "uuid";
import { fakeQuestion, fakeRoom, fakeUser, getFakeBackend, FakeDb } from "./fakes.js";

export { getFakeBackend };

// A room plus `host` and `participants` seeds. The returned room is the *fake*
// room (id, pin, hostId, status), which is what the services return.
export async function setupRoom(backend = getFakeBackend(), overrides = {}) {
  const room = await backend.roomService.create({
    hostId: backend.hostId,
    title: "Quiz in a box",
    maxParticipants: 200,
    ...overrides,
  });
  const host = await backend.db.query(
    "INSERT INTO users (id, nickname, room_id, role) VALUES ($1, $2, $3, 'host') RETURNING id, nickname, role",
    [backend.hostId, "Host", room.id]
  );
  const participants = [];
  for (let i = 0; i < 3; i++) {
    const user = await backend.db.query(
      "INSERT INTO users (nickname, room_id, role) VALUES ($1, $2, 'participant') RETURNING id, nickname, role",
      [uuidv4().slice(0, 8), room.id]
    );
    const p = {
      backend,
      user: user.rows[0],
      submitAnswer: (questionId, answer) =>
        submitAnswer(backend, { user: user.rows[0] }, questionId, answer),
    };
    participants.push(p);
    await backend.roomService.addParticipant();
  }
  const result = { ...room, host: host.rows[0], participants };
  backend.room = result;
  return result;
}

// Joins a guest to the backend's current room and counts them in memory.
export function joinParticipant(backend, nickname) {
  const user = { id: backend.db.users.length + 1, nickname, role: "participant" };
  backend.db.users.push(user);
  return backend.roomService.join(user.id, nickname);
}

// Submit an answer on behalf of a participant, mirroring the client flow.
export async function submitAnswer(backend, participant, questionId, answer) {
  const existing = await backend.submissionService.exists(participant.user.id, questionId);
  if (existing) throw new Error("already answered");
  return backend.submissionService.create({
    questionId,
    participantId: participant.user.id,
    roomPin: backend.roomService.room.pin,
    answer,
  });
}

// A room plus `timeLimit` questions (type `mcq`), hosted by the room host.
export function seedBackend(backend = getFakeBackend()) {
  const db = backend.db instanceof FakeDb ? backend.db : null;
  if (!db) return backend;
  return backend;
}

export async function setupRoomWithQuestions(backend = getFakeBackend(), timeLimit = 10) {
  backend = seedBackend(backend);
  const room = await setupRoom(backend);
  const questions = await seedQuestions(backend, room, timeLimit, "mcq");
  return { ...room, questions };
}

// `count` questions of the given type; `count` is the question count when
// below 10, otherwise the time limit of the questions it creates.
export async function seedQuestions(backend, room, countOrTimeLimit, type = "mcq") {
  const effectiveRoom = room || backend.room;
  const isCount = typeof countOrTimeLimit === "number" && countOrTimeLimit > 1;
  const count = isCount ? countOrTimeLimit : 1;
  const timeLimit = typeof countOrTimeLimit === "number" ? countOrTimeLimit : 10;
  const creatorId = effectiveRoom?.host?.id ?? 1;
  const roomId = effectiveRoom?.id ?? 1;
  const questions = [];
  for (let i = 0; i < count; i++) {
    const q = await backend.questionService.create({
      roomId,
      creatorId,
      type,
      question: { text: `Question ${i + 1}?` },
      options: ["a", "b", "c"],
      timeLimit,
    });
    questions.push(q);
  }
  return isCount ? questions : questions[0];
}
