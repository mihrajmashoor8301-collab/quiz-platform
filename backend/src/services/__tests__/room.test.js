import { describe, it, expect, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { joinParticipant, setupRoom, submitAnswer } from "../../../test/helpers.js";
import { getFakeBackend, FakeDb } from "../../../test/fakes.js";
import SubmissionService from "../submission.service.js";

describe("roomService", () => {
  let backend;

  beforeEach(() => {
    backend = getFakeBackend();
  });

  it("create() returns id, pin, hostId, currentParticipants and status", async () => {
    const room = await backend.roomService.create({
      hostId: 1,
      title: "Quiz in a box",
      maxParticipants: 200,
    });
    expect(room).toMatchObject({
      id: expect.any(Number),
      pin: expect.any(String),
      hostId: 1,
      currentParticipants: 0,
      status: "queued",
    });
    expect(room.pin.length).toBe(6);
    // PINs are unique across rooms.
    const second = await backend.roomService.create({ hostId: 1, title: "Another" });
    expect(second.pin).not.toBe(room.pin);
  });

  it("create() defaults to maxParticipants 200", async () => {
    const room = await backend.roomService.create({ hostId: 1, title: "Quiz in a box" });
    expect(room.maxParticipants).toBe(200);
  });

  it("join()/leave() track participants in memory", async () => {
    await backend.roomService.create({ hostId: 1, title: "Quiz in a box" });
    const guest = await backend.db.query(
      "INSERT INTO users (nickname, room_id) VALUES ($1, $2) RETURNING id",
      [uuidv4().slice(0, 8), backend.roomService.room.id]
    );
    const state = backend.roomService.join(guest.rows[0].id, "guest");
    expect(state.currentParticipants).toBe(1);

    const left = backend.roomService.leave(guest.rows[0].id);
    expect(left.currentParticipants).toBe(0);
  });

  it("addParticipant() and removeParticipantRow() keep the DB count in sync", async () => {
    await backend.roomService.create({ hostId: 1, title: "Quiz in a box" });
    await backend.roomService.addParticipant();
    const { rows } = await backend.db.query(
      "SELECT current_participants FROM rooms WHERE pin = $1",
      [backend.roomService.room.pin]
    );
    expect(rows[0].current_participants).toBe(1);

    await backend.roomService.removeParticipantRow(1);
    const { rows: after } = await backend.db.query(
      "SELECT current_participants FROM rooms WHERE pin = $1",
      [backend.roomService.room.pin]
    );
    expect(after[0].current_participants).toBe(0);
  });

  it("status transitions are persisted", async () => {
    await backend.roomService.create({ hostId: 1, title: "Quiz in a box" });
    expect((await backend.roomService.start()).status).toBe("running");
    expect((await backend.roomService.pause()).status).toBe("paused");
    expect((await backend.roomService.finish()).status).toBe("finished");
    const { rows } = await backend.db.query(
      "SELECT status, started_at IS NOT NULL AS started, finished_at IS NOT NULL AS finished FROM rooms WHERE pin = $1",
      [backend.roomService.room.pin]
    );
    expect(rows[0]).toEqual({ status: "finished", started: true, finished: true });
  });

  it("rooms are stored with their PIN", async () => {
    await backend.roomService.create({ hostId: 1, title: "Quiz in a box" });
    const { rows } = await backend.db.query(
      "SELECT pin, host_id, title, max_participants, status FROM rooms WHERE pin = $1",
      [backend.roomService.room.pin]
    );
    expect(rows).toEqual([
      {
        pin: backend.roomService.room.pin,
        host_id: 1,
        title: "Quiz in a box",
        max_participants: 200,
        status: "queued",
      },
    ]);
  });
});

describe("questionService", () => {
  let backend;

  beforeEach(() => {
    backend = getFakeBackend();
  });

  it("create() inserts a question and returns it as queued", async () => {
    const room = await backend.roomService.create({ hostId: 1, title: "Quiz in a box" });
    const q = await backend.questionService.create({
      roomId: room.id,
      creatorId: 1,
      type: "mcq",
      question: { text: "1+1?" },
      options: ["1", "2", "3"],
      timeLimit: 30,
    });
    expect(q).toEqual({
      id: expect.any(Number),
      roomId: room.id,
      creatorId: 1,
      type: "mcq",
      question: { text: "1+1?" },
      options: ["1", "2", "3"],
      timeLimit: 30,
      status: "queued",
      createdAt: expect.any(Date),
    });

    const { rows } = await backend.db.query(
      "SELECT id, room_id, creator_id, type, question, options, time_limit, status FROM questions WHERE id = $1",
      [q.id]
    );
    expect(rows[0]).toEqual({
      id: q.id,
      room_id: room.id,
      creator_id: 1,
      type: "mcq",
      question: '{"text":"1+1?"}',
      options: ["1", "2", "3"],
      time_limit: 30,
      status: "queued",
    });
  });
});

describe("submissionService", () => {
  let backend;

  beforeEach(() => {
    backend = getFakeBackend();
  });

  it("create() validates answers server-side and records valid submissions", async () => {
    const room = await setupRoom(backend);
    const question = await backend.questionService.create({
      roomId: room.id,
      creatorId: room.host.id,
      type: "mcq",
      question: { text: "1+1?" },
      options: ["1", "2", "3"],
      timeLimit: null,
    });
    await backend.questionService.close(["2"]);

    const s = await backend.submissionService.create({
      questionId: question.id,
      participantId: room.participants[0].user.id,
      roomPin: room.pin,
      answer: "2",
    });
    expect(s).toMatchObject({
      questionId: question.id,
      participantId: room.participants[0].user.id,
      roomPin: room.pin,
      answer: "2",
      valid: true,
    });

    const { rows } = await backend.db.query(
      "SELECT valid, COUNT(*) FROM submissions WHERE question_id = $1 GROUP BY valid",
      [question.id]
    );
    expect(rows).toEqual([{ valid: true, count: 1 }]);
  });

  it("create() rejects duplicates", async () => {
    const room = await setupRoom(backend);
    const question = await backend.questionService.create({
      roomId: room.id,
      creatorId: room.host.id,
      type: "mcq",
      question: { text: "1+1?" },
      options: ["1", "2", "3"],
      timeLimit: null,
    });
    await backend.questionService.close(["2"]);
    await submitAnswer(backend, room.participants[0], question.id, "2");
    await expect(
      submitAnswer(backend, room.participants[0], question.id, "2")
    ).rejects.toThrow("already answered");
  });

  it("create() rejects answers that do not match the question", async () => {
    const room = await setupRoom(backend);
    const question = await backend.questionService.create({
      roomId: room.id,
      creatorId: room.host.id,
      type: "mcq",
      question: { text: "1+1?" },
      options: ["1", "2", "3"],
      timeLimit: null,
    });
    await backend.questionService.close(["2"]);
    await expect(
      backend.submissionService.create({
        questionId: question.id,
        participantId: room.participants[0].user.id,
        roomPin: room.pin,
        answer: "4",
      })
    ).rejects.toThrow(/answer does not match|question is not closed/);
  });

  it("create() rejects questions that are not closed", async () => {
    const room = await setupRoom(backend);
    const question = await backend.questionService.create({
      roomId: room.id,
      creatorId: room.host.id,
      type: "mcq",
      question: { text: "1+1?" },
      options: ["1", "2", "3"],
      timeLimit: null,
    });
    await expect(
      backend.submissionService.create({
        questionId: question.id,
        participantId: room.participants[0].user.id,
        roomPin: room.pin,
        answer: "2",
      })
    ).rejects.toThrow("question is not closed");
  });
});
