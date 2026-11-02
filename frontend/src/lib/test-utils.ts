export class FakeDb {
  rooms: any[];
  users: any[];
  questions: any[];
  answers: any[];
  submissions: any[];
  archives: any[];

  constructor() {
    this.rooms = [];
    this.users = [];
    this.questions = [];
    this.answers = [];
    this.submissions = [];
    this.archives = [];
  }

  async query(sql: string, options: { lock?: boolean } = {}) {
    void options;
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
    const target = this[table as "rooms" | "users" | "questions" | "answers" | "submissions" | "archives"];
    const id = target.push(parsed[0]) ? target.length : 1;
    return { rows: [{ id }] };
  }
}

export class PinGenerator {
  occupied: Set<string>;

  constructor(occupied: Set<string> = new Set()) {
    this.occupied = occupied;
  }

  generate(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      if (!this.occupied.has(pin)) return pin;
    }
    throw new Error("could not generate a unique room PIN");
  }
}

export function validateAnswer(answer: string, acceptedAnswers: string[]): boolean {
  if (!acceptedAnswers || acceptedAnswers.length === 0) return false;
  const normalized = (a: any) => String(a ?? "").trim().toLowerCase();
  const input = normalized(answer);
  return acceptedAnswers.some((accepted) => normalized(accepted) === input);
}
