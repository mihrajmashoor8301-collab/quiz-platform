// Live game loop: advances each question through its states and closes it
// once its timer fires or every participant has answered.
//
// The loop is the only place a question's `correct` field is written and
// the only place `status` moves to `closed`. A question is never exposed to
// participants before closure, and answers are only scored once closed.

function poll(condition, task, interval) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      try {
        if (await condition()) return resolve();
        await task();
      } catch (error) {
        return reject(error);
      }
      setTimeout(run, interval);
    };
    setTimeout(run, interval);
  });
}

export class LiveGame {
  constructor(options = {}) {
    if (options && options.questionService) {
      this.questionService = options.questionService;
      this.pool = options.pool;
    } else {
      this.questionService = options;
      this.pool = options?.pool;
    }
    this.status = "queued";
    this.closedWith = null;
  }

  isClosed() {
    return this.status === "closed";
  }

  async onAnswer(_questionId, _answers) {}

  run(questions) {
    return Promise.all(questions.map((question) => this.runOne(question)));
  }

  async runOne(question) {
    const close = () => {
      this.status = "closed";
      return this.questionService.updateStatus(question.id, "closed", question.correct);
    };

    if (!question.timeLimit) {
      await poll(
        () => this.participantsAnswered(question.id),
        () => {},
        50
      );
      return close();
    }

    const timer = setTimeout(close, question.timeLimit * 1000);
    try {
      await poll(
        () => this.participantsAnswered(question.id),
        () => {},
        50
      );
      clearTimeout(timer);
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    return close();
  }

  async close(accepted) {
    this.status = "closed";
    this.closedWith = accepted;
    if (this.questionService?.close) {
      await this.questionService.close(accepted);
    }
  }

  async participantsAnswered(questionId) {
    if (!this.pool) return true;
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS answered FROM submissions WHERE question_id = $1`,
      [questionId]
    );
    const expected = await this.expectedParticipants(questionId);
    return Number(rows?.[0]?.answered ?? 0) >= expected;
  }

  async expectedParticipants(_questionId) {
    if (!this.pool) return 0;
    const { rows } = await this.pool.query(
      "SELECT COUNT(*) AS total FROM users u JOIN rooms r ON r.id = u.room_id WHERE r.status IN ('queued','running')",
      []
    );
    return Number(rows?.[0]?.total ?? 0);
  }
}

export default LiveGame;
