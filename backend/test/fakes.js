// Fake backend container and seeds. The services take a `backend` container
// exposing `db`, `pin`, `hostId`, `status` (and `questionService` for the
// game loop). Tests build it from these fakes, so services stay decoupled
// from Express, Socket.IO and PostgreSQL.
import { v4 as uuidv4 } from "uuid";
import Pool from "../src/services/pool.js";
import RoomService from "../src/services/room.service.js";
import QuestionService from "../src/services/question.service.js";
import SubmissionService from "../src/services/submission.service.js";
import { PinGenerator } from "../src/utils/pin-generator.js";

const validateAnswer = (answer, correct = []) => {
  if (!correct || correct.length === 0) return false;
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  return correct.some((c) => norm(c) === norm(answer));
};

function projectRow(row, cols) {
  if (!cols) return { ...row };
  const res = {};
  for (const c of cols) {
    const alias = /\s+AS\s+(\w+)/i.exec(c);
    const key = alias ? alias[1] : c.trim();
    if (c.includes("IS NOT NULL")) {
      const orig = c.split(/\s+/)[0];
      res[key] = row[orig] !== null && row[orig] !== undefined;
    } else {
      res[key] = row[key];
    }
  }
  return res;
}

export class FakeDb {
  constructor() {
    this.rooms = [];
    this.users = [];
    this.questions = [];
    this.answers = [];
    this.submissions = [];
    this.archives = [];
  }

  static substituted(sql, params = []) {
    return sql.replace(/\$[0-9]+/g, (m) => JSON.stringify(params[+m.slice(1) - 1] ?? null));
  }

  async query(sql, params = []) {
    const s = FakeDb.substituted(sql, params);

    if (/^SELECT/i.test(s)) return this.select(s, params, sql);
    if (/^UPDATE/i.test(s) || /^DELETE/i.test(s)) return this.updateOrDelete(sql, params, s);

    const tableMatch = /INSERT INTO (\w+)/i.exec(s);
    if (!tableMatch) throw new Error(`unexpected query: ${s}`);
    const table = tableMatch[1];
    if (!this[table]) this[table] = [];

    const colMatch = /INSERT INTO \w+ \((.*?)\)/i.exec(sql);
    const row = {};
    if (colMatch) {
      const cols = colMatch[1].split(",").map((c) => c.trim());
      cols.forEach((col, i) => {
        row[col] = params[i];
      });
    }

    if (table === "rooms") {
      row.status = row.status ?? "queued";
      row.current_participants = row.current_participants ?? 0;
      row.started_at = null;
      row.finished_at = null;
    }
    if (table === "questions") {
      row.status = row.status ?? "queued";
      row.correct = row.correct ?? null;
      if (typeof row.question === "object") {
        row.question = JSON.stringify(row.question);
      }
    }
    if (table === "submissions") {
      row.score = row.score ?? null;
    }

    const id = row.id ? Number(row.id) : this[table].length + 1;
    row.id = id;
    this[table].push(row);

    const retMatch = /RETURNING (.*)$/i.exec(sql);
    const projected = { id };
    if (retMatch && retMatch[1]) {
      const retCols = retMatch[1].split(",").map((c) => c.trim());
      retCols.forEach((col) => {
        if (row[col] !== undefined) projected[col] = row[col];
      });
    }
    return { rows: [projected] };
  }

  select(s, params = [], sql = s) {
    let cols = null;
    const colMatch = /^SELECT\s+(.*?)\s+FROM/i.exec(sql);
    if (colMatch && !colMatch[1].includes("*")) {
      cols = colMatch[1].split(",").map((c) => c.trim());
    }

    if (/FROM rooms/i.test(s)) {
      if (/IS NOT NULL/i.test(s)) {
        const room = this.rooms[this.rooms.length - 1] ?? {};
        return {
          rows: [
            projectRow(room, cols),
          ],
        };
      }
      if (/WHERE pin =/i.test(s)) {
        const pinMatch = /pin = "([^"]+)"|pin = '([^']+)'/.exec(s);
        const pin = pinMatch ? (pinMatch[1] || pinMatch[2]) : params[0];
        const filtered = this.rooms.filter((r) => r.pin === pin);
        return { rows: filtered.map((r) => projectRow(r, cols)) };
      }
      return { rows: this.rooms.map((r) => projectRow(r, cols)) };
    }

    if (/FROM users/i.test(s)) {
      if (/WHERE room_id =/i.test(s)) {
        const rid = params[0];
        return { rows: this.users.filter((u) => u.room_id === rid).map((r) => projectRow(r, cols)) };
      }
      return { rows: this.users.map((r) => projectRow(r, cols)) };
    }

    if (/FROM questions/i.test(s)) {
      if (/WHERE id =/i.test(s)) {
        const id = params[0];
        const found = this.questions.find((q) => q.id === id);
        return { rows: found ? [projectRow(found, cols)] : [] };
      }
      return { rows: this.questions.map((r) => projectRow(r, cols)) };
    }

    if (/FROM submissions/i.test(s)) {
      if (/GROUP BY valid/i.test(s)) {
        const qid = params[0];
        const subs = this.submissions.filter((sub) => sub.question_id === qid);
        const groups = {};
        for (const sub of subs) {
          const v = Boolean(sub.valid);
          groups[v] = (groups[v] ?? 0) + 1;
        }
        const rows = Object.entries(groups).map(([valid, count]) => ({
          valid: valid === "true",
          count,
        }));
        return { rows };
      }
      if (/WHERE participant_id =/i.test(s) && /question_id =/i.test(s)) {
        const pid = params[0];
        const qid = params[1];
        const found = this.submissions.filter(
          (sub) => sub.participant_id === pid && sub.question_id === qid
        );
        return { rows: found.map((r) => projectRow(r, cols)) };
      }
      if (/COUNT\(\*\) AS answered/i.test(s)) {
        const qid = params[0];
        const count = this.submissions.filter((sub) => sub.question_id === qid).length;
        return { rows: [{ answered: count }] };
      }
      return { rows: this.submissions.map((r) => projectRow(r, cols)) };
    }

    if (/COUNT\(\*\) AS total FROM users/i.test(s)) {
      return { rows: [{ total: this.users.length }] };
    }

    return { rows: [] };
  }

  updateOrDelete(sql, params, s) {
    if (/UPDATE rooms/i.test(s)) {
      const pin = params[params.length - 1];
      const room = this.rooms.find((r) => r.pin === pin) || this.rooms[this.rooms.length - 1];
      if (room) {
        if (/SET status = 'running'/i.test(s)) {
          room.status = "running";
          room.started_at = new Date();
        } else if (/SET status = 'paused'/i.test(s)) {
          room.status = "paused";
        } else if (/SET status = 'finished'/i.test(s)) {
          room.status = "finished";
          room.finished_at = new Date();
        } else if (/current_participants = current_participants \+ 1/i.test(s)) {
          room.current_participants = (room.current_participants ?? 0) + 1;
        } else if (/current_participants = 0/i.test(s)) {
          room.current_participants = 0;
        }
      }
      return { rows: [] };
    }

    if (/UPDATE questions/i.test(s)) {
      const id = params[0];
      const q = this.questions.find((x) => x.id === id);
      if (q) {
        if (params.length === 3) {
          q.status = params[1];
          q.correct = params[2];
        } else {
          q.status = params[1];
        }
      }
      return { rows: [] };
    }

    if (/UPDATE submissions/i.test(s)) {
      const subId = params[0];
      const sub = this.submissions.find((x) => x.id === subId);
      if (sub && /score = 1/i.test(s)) {
        sub.score = 1;
      }
      return { rows: [] };
    }

    if (/DELETE FROM users/i.test(s)) {
      const userId = Number(params[0]);
      const roomId = Number(params[1]);
      const idx = this.users.findIndex((u) => u.id === userId && u.room_id === roomId);
      if (idx !== -1) {
        this.users.splice(idx, 1);
      }
      const room = this.rooms.find((r) => r.id === roomId) || this.rooms[this.rooms.length - 1];
      if (room && room.current_participants > 0) {
        room.current_participants -= 1;
      }
      return { rows: [] };
    }

    return { rows: [] };
  }

  tableFor(sql) {
    const m = /FROM (\w+)/i.exec(sql) || /INSERT INTO (\w+)/i.exec(sql);
    return m ? m[1] : undefined;
  }
}

export const fakeRoom = {
  id: 1,
  pin: "111111",
  hostId: 1,
  title: "Quiz in a box",
  maxParticipants: 200,
  status: "queued",
  currentParticipants: 0,
  participants: new Map(),
  state() {
    return { ...this, participants: this.participants };
  },
};

export const fakeQuestion = {
  id: 1,
  roomPin: "111111",
  status: "closed",
  correct: ["b"],
  type: "mcq",
  timeLimit: null,
  async byId(id) {
    return id === this.id ? this : null;
  },
};

export function getFakeRoomService(httpServer = null) {
  const backend = getFakeBackend();
  const roomService = new RoomService(backend, httpServer);
  backend.roomService = roomService;
  return roomService;
}

export function getFakeBackend() {
  const db = new FakeDb();
  const backend = {
    db,
    pool: db,
    pin: null,
    pins: new Set(),
    room: null,
  };

  const roomService = new RoomService(backend, null);
  const questionService = new QuestionService(backend);
  const submissionService = new SubmissionService(backend);

  backend.roomService = roomService;
  backend.questionService = questionService;
  backend.submissionService = submissionService;

  Object.defineProperty(backend, "pin", {
    get() {
      return roomService.room?.pin ?? null;
    },
    set(v) {
      if (roomService.room) roomService.room.pin = v;
    },
    configurable: true,
  });

  Object.defineProperty(backend, "hostId", {
    get() {
      return 1;
    },
  });

  Object.defineProperty(backend, "status", {
    get() {
      return roomService.room?.status ?? "queued";
    },
  });

  Object.defineProperty(backend, "questions", {
    get() {
      return db.questions;
    },
  });

  Object.defineProperty(backend, "submissions", {
    get() {
      return db.submissions;
    },
  });

  return backend;
}

export const fakeUser = { id: 1, nickname: "guest-1", role: "participant" };
export const validateAnswerFn = validateAnswer;
