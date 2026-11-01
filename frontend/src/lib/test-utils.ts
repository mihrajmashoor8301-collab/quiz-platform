class FakeDb {
  constructor() {
    this.rooms = [];
    this.users = [];
    this.questions = [];
    this.answers = [];
    this.submissions = [];
    this.archives = [];
  }

  async query(sql, { lock } = {}) {
    const table = /INSERT INTO users/.test(sql)
      ? "users"
      : /INSERT INTO rooms/.test(sql)
      ? "rooms"
      : /INSERT INTO questions/.test(sql)
      ? "questions"
      : /INSERT INTO answers/.test(sql)
      ? "answers"
      : /INSERT INTO submissions/.test(sql)
      ? "submissions"
      : /INSERT INTO archives/.test(sql)
      ? "archives"
      : null;
    if (!table) throw new Error(`unexpected query: ${sql}`);
    const values = sql.slice(sql.indexOf("VALUES ")).trimEnd();
    const parsed = JSON.parse(`[${values}]`);
    const id = this[table].push(parsed[0]) ? this[table].length : 1;
    return { rows: [{ id }] };
  }
}

class PinGenerator {
  constructor(occupied) {
    this.occupied = occupied;
  }

  generate() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      if (!this.occupied.has(pin)) return pin;
    }
    throw new Error("could not generate a unique room PIN");
  }
}

function validateAnswer(answer, acceptedAnswers) {
  if (!acceptedAnswers || acceptedAnswers.length === 0) return false;
  const normalized = (a) => String(a ?? "").trim().toLowerCase();
  const input = normalized(answer);
  return acceptedAnswers.some((accepted) => normalized(accepted) === input);
}

module.exports = { FakeDb, PinGenerator, validateAnswer };
