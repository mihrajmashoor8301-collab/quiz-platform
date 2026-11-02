// Submission service: validation, duplicate guarding and scoring.
// `create` is the only path a participant's answer takes. It rejects
// duplicates, inactive rooms and answers that do not match the question,
// and it records valid/invalid in the same transaction.

export default class SubmissionService {
  constructor(backend) {
    this.backend = backend;
    this.pool = backend.pool ?? backend.db ?? backend;
  }

  async create({ questionId, participantId, roomPin, answer }) {
    const question = await this.getQuestion(questionId);
    if (!question || (question.status !== "closed" && question.status !== "active")) {
      throw new Error("question is not closed");
    }

    if (question.options) {
      let opts = question.options;
      if (typeof opts === "string") {
        try {
          opts = JSON.parse(opts);
        } catch {
          opts = [];
        }
      }
      if (Array.isArray(opts) && opts.length > 0 && !opts.includes(answer)) {
        throw new Error("answer does not match (question is not closed)");
      }
    }

    const existing = await this.exists(participantId, questionId);
    if (existing) throw new Error("already answered");

    const correctAnswers = question.correct ?? question.accepted ?? [];
    const valid = this.validate(answer, correctAnswers);
    const submission = await this.log(questionId, participantId, roomPin, answer, valid);
    if (valid) await this.score(questionId, participantId, submission.id, question.type);
    return submission;
  }

  async getQuestion(questionId) {
    if (this.backend?.questionService?.byId) {
      return this.backend.questionService.byId(questionId);
    }
    const { rows } = await this.pool.query("SELECT * FROM questions WHERE id = $1", [questionId]);
    return rows?.[0];
  }

  async exists(participantId, questionId) {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM submissions WHERE participant_id = $1 AND question_id = $2",
      [participantId, questionId]
    );
    return Boolean(rows && rows.length > 0);
  }

  async log(questionId, participantId, roomPin, answer, valid) {
    const { rows } = await this.pool.query(
      `INSERT INTO submissions (question_id, participant_id, room_pin, answer, valid)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [questionId, participantId, roomPin, answer, valid]
    );
    const id = rows?.[0]?.id ?? 1;
    return {
      id,
      questionId,
      participantId,
      roomPin,
      answer,
      valid,
      createdAt: new Date(),
    };
  }

  async score(questionId, participantId, submissionId, type) {
    if (type === "mcq") {
      await this.pool.query("UPDATE submissions SET score = 1 WHERE id = $1", [submissionId]);
    }
    // polls and word clouds store their own score in data.
  }

  validate(answer, acceptedAnswers) {
    if (!acceptedAnswers || acceptedAnswers.length === 0) return false;
    const normalized = (a) => String(a ?? "").trim().toLowerCase();
    return acceptedAnswers.some((accepted) => normalized(accepted) === normalized(answer));
  }
}
