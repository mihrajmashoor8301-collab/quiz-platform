// Question service: creation, retrieval and closure.
// Questions are `queued` until the game loop broadcasts them. A question is
// only `closed` by the game loop once its timer fires or every participant
// has answered, so no answer is ever exposed before closure.

export default class QuestionService {
  constructor(backend) {
    this.backend = backend;
    this.pool = backend.pool ?? backend.db ?? backend;
    this.question = null;
  }

  async create({ roomId, creatorId, type, question, options, timeLimit }) {
    const { rows } = await this.pool.query(
      `INSERT INTO questions (room_id, creator_id, type, question, options, time_limit)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [roomId, creatorId, type, question, options, timeLimit]
    );
    const id = rows?.[0]?.id ?? 1;
    this.question = {
      id,
      roomId,
      creatorId,
      type,
      question,
      options,
      timeLimit,
      status: "queued",
      createdAt: new Date(),
    };
    return this.question;
  }

  async updateStatus(id, status, correct) {
    const set = correct === undefined ? "status = $2" : "status = $2, correct = $3";
    const values = correct === undefined ? [id, status] : [id, status, correct];
    await this.pool.query(`UPDATE questions SET ${set} WHERE id = $1`, values);
    if (this.question && this.question.id === id) {
      this.question.status = status;
      if (correct !== undefined) this.question.correct = correct;
    }
  }

  async schedule(timeLimitSeconds) {
    const delay = (timeLimitSeconds ?? 30) * 1000;
    return new Promise((resolve) => {
      this.timeout = setTimeout(() => resolve(this.close()), delay);
    });
  }

  cancel() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }

  // Closes this question with the accepted answers chosen by the host.
  async close(accepted = []) {
    this.cancel();
    if (this.question) {
      this.question.status = "closed";
      this.question.correct = accepted;
      this.question.accepted = accepted;
      await this.updateStatus(this.question.id, "closed", accepted);
    }
    return this.state();
  }

  // The current question as the caller received it from `create()`.
  state() {
    return this.question;
  }

  async byId(id) {
    const { rows } = await this.pool.query("SELECT * FROM questions WHERE id = $1", [id]);
    if (rows && rows[0]) return rows[0];
    return this.question?.id === id ? this.question : null;
  }
}
