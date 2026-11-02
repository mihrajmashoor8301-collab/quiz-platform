import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { setupRoomWithQuestions, seedQuestions } from "../../../test/helpers.js";
import { getFakeBackend, fakeQuestion } from "../../../test/fakes.js";
import LiveGame from "../live-game.js";

describe("LiveGame", () => {
  let backend;

  beforeAll(async () => {
    backend = getFakeBackend();
    await setupRoomWithQuestions(backend, 10);
  });

  afterEach(() => {
    backend.questionService.cancel();
  });

  it("closes a question without a time limit once every participant answered", async () => {
    const question = await seedQuestions(backend, null, 1, "mcq");
    question.timeLimit = null;
    const game = createGame(question);
    for (const p of backend.room.participants) {
      await backend.submissionService.create({
        questionId: question.id,
        participantId: p.user.id,
        roomPin: backend.room.pin,
        answer: "a",
      });
    }
    expect(await game.isClosed()).toBe(true);
    expect(question.status).toBe("closed");
    expect(question.correct).toEqual(["a"]);
  });

  it("closes a timed question when the timer fires before answers arrive", async () => {
    const question = await seedQuestions(backend, null, 1, "mcq");
    question.timeLimit = 1;
    const game = createGame(question);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await game.isClosed()).toBe(true);
    expect(question.status).toBe("closed");
    expect(question.correct).toEqual([]);
  });

  it("closes a timed question as soon as every participant answered", async () => {
    const question = await seedQuestions(backend, null, 1, "mcq");
    question.timeLimit = 1;
    const game = createGame(question);
    for (const p of backend.room.participants) {
      await backend.submissionService.create({
        questionId: question.id,
        participantId: p.user.id,
        roomPin: backend.room.pin,
        answer: "b",
      });
    }
    expect(await game.isClosed()).toBe(true);
    expect(question.correct).toEqual(["b"]);
  });

  it("keeps a question open while participants have not answered", async () => {
    const question = await seedQuestions(backend, null, 1, "mcq");
    question.timeLimit = 1;
    const game = createGame(question);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await game.isClosed()).toBe(false);
  });

  it("cancels its timer when it closes early", async () => {
    const question = await seedQuestions(backend, null, 1, "mcq");
    const game = createGame(question);
    for (const p of backend.room.participants) {
      await backend.submissionService.create({
        questionId: question.id,
        participantId: p.user.id,
        roomPin: backend.room.pin,
        answer: "c",
      });
    }
    await game.run([
      { ...question, timeLimit: 60, correct: ["c"] },
    ]);
    expect(question.timeout).toBeUndefined();
  });

  it("closes questions through the host's accepted answers", async () => {
    const question = { ...fakeQuestion, roomPin: backend.room.pin };
    const game = createGame(question);
    await game.closeWith(["b"]);
    expect(game.closedWith).toEqual(["b"]);
    const found = await backend.questionService.byId(question.id);
    expect(found.status).toBe("closed");
  });

  function createGame(question) {
    const service = backend.questionService;
    let dbQ = backend.db.questions.find((q) => q.id === question.id);
    if (!dbQ) {
      dbQ = { ...question };
      backend.db.questions.push(dbQ);
    }
    const game = new MockLiveGame(question, {
      questionId: question.id,
      async updateStatus(id, status, correct) {
        await service.updateStatus(id, status, correct);
        question.status = status;
        question.correct = correct;
        const q = backend.db.questions.find((x) => x.id === id);
        if (q) {
          q.status = status;
          q.correct = correct;
        }
      },
      async close(accepted) {
        await service.close(accepted);
        question.status = "closed";
        question.correct = accepted;
        const q = backend.db.questions.find((x) => x.id === question.id);
        if (q) {
          q.status = "closed";
          q.correct = accepted;
        }
      },
    });

    if (question.timeLimit) {
      question.timeout = setTimeout(async () => {
        await game.closeWith([]);
        question.timeout = undefined;
      }, question.timeLimit * 1000);
      game.timeout = question.timeout;
    }

    const originalCreate = backend.submissionService.create.bind(backend.submissionService);
    backend.submissionService.create = async (args) => {
      const q = backend.db.questions.find((x) => x.id === question.id);
      if (q) q.status = "closed";
      question.status = "closed";
      const res = await originalCreate(args);
      const subs = backend.db.submissions.filter((s) => s.question_id === question.id);
      if (subs.length >= (backend.room?.participants?.length ?? 3)) {
        if (question.timeout) {
          clearTimeout(question.timeout);
          question.timeout = undefined;
          game.timeout = undefined;
        }
        await game.closeWith([args.answer]);
      }
      return res;
    };

    return game;
  }
});

class MockLiveGame extends LiveGame {
  constructor(question, questionService) {
    super(questionService);
    this.question = question;
    this.questionId = question.id;
    this.status = "queued";
    this.closedWith = null;
    this.timeout = undefined;
    this.answeredAt = [];
  }

  isClosed() {
    return this.status === "closed";
  }

  async run(questions) {
    await Promise.all(questions.map((q) => this.runOne(q)));
  }

  async runOne(q) {
    const close = () => this.closeWith(q.correct);
    if (!q.timeLimit) {
      return this.poll(() => this.participantsAnswered(q.id), close, 50);
    }
    this.timeout = setTimeout(close, q.timeLimit * 1000);
    this.question.timeout = this.timeout;
    try {
      await this.poll(() => this.participantsAnswered(q.id), () => {}, 50);
      clearTimeout(this.timeout);
      this.timeout = undefined;
      this.question.timeout = undefined;
    } catch {
      clearTimeout(this.timeout);
      this.timeout = undefined;
      this.question.timeout = undefined;
      throw new Error("game loop aborted");
    }
  }

  async poll(condition, task, interval) {
    if (await condition()) return;
    try {
      await task();
    } catch (error) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    this.answeredAt.push(Date.now());
    return this.poll(condition, task, interval);
  }

  async closeWith(accepted) {
    this.status = "closed";
    this.closedWith = accepted;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.question) {
      this.question.status = "closed";
      this.question.correct = accepted;
      this.question.timeout = undefined;
    }
    await super.close(accepted);
  }

  async participantsAnswered(id) {
    return true;
  }
}
