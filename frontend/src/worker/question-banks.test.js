import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneQuestionsForQuiz } from "../lib/question-bank-utils.ts";
import { handleApiRequest } from "./api.js";

const HOST_A = "a5e7eb32-df63-4c7f-8de8-b8f540bc854c";
const HOST_B = "b5e7eb32-df63-4c7f-8de8-b8f540bc854c";
const BANK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BANK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUESTION_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const QUESTION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKENS = { "host-a-access-token-long": HOST_A, "host-b-access-token-long": HOST_B };
const validQuestion = {
  question: "What is H2O?",
  options: ["Water", "Air"],
  correct: "Water",
  timeLimit: 20,
  explanation: "It is a water molecule.",
  source: { lesson: 4 },
};

function createEnvironment() {
  const database = { question_banks: [], bank_questions: [] };
  const restUrls = [];
  let sequence = 1;
  const newId = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  const env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ROOMS: {
      idFromName: (id) => id,
      get: () => ({ fetch: async () => Response.json({ allowed: true }) }),
    },
  };
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") {
      const token = init.headers?.authorization?.replace(/^Bearer\s+/i, "");
      const id = TOKENS[token];
      return id ? Response.json({ id }) : new Response("{}", { status: 401 });
    }
    if (!url.pathname.startsWith("/rest/v1/")) throw new Error(`Unexpected URL ${url}`);
    restUrls.push(url.toString());
    const table = url.pathname.slice("/rest/v1/".length);
    const rows = database[table];
    if (!rows) throw new Error(`Unexpected table ${table}`);

    const matches = (row) => {
      for (const key of ["id", "host_id", "bank_id"]) {
        const value = url.searchParams.get(key);
        if (!value) continue;
        if (value.startsWith("eq.") && row[key] !== value.slice(3)) return false;
        if (value.startsWith("in.(")) {
          const ids = value.slice(4, -1).split(",");
          if (!ids.includes(row[key])) return false;
        }
      }
      return true;
    };
    const method = init.method || "GET";
    if (method === "POST") {
      const payload = JSON.parse(init.body);
      const inserted = (Array.isArray(payload) ? payload : [payload]).map((item) => {
        const now = new Date().toISOString();
        const row = {
          id: item.id || newId(),
          created_at: item.created_at || now,
          updated_at: item.updated_at || now,
          ...(table === "question_banks" ? { description: "" } : {}),
          ...item,
        };
        rows.push(row);
        return row;
      });
      return Response.json(inserted, { status: 201 });
    }
    if (method === "PATCH") {
      const patch = JSON.parse(init.body);
      const changed = rows.filter(matches);
      changed.forEach((row) => Object.assign(row, patch));
      return Response.json(changed);
    }
    if (method === "DELETE") {
      const deleted = rows.filter(matches);
      database[table] = rows.filter((row) => !matches(row));
      if (table === "question_banks") {
        const deletedIds = new Set(deleted.map((row) => row.id));
        database.bank_questions = database.bank_questions.filter((row) => !deletedIds.has(row.bank_id));
      }
      return Response.json(deleted);
    }

    let selected = rows.filter(matches);
    const order = url.searchParams.get("order");
    if (order?.startsWith("position.desc")) selected = [...selected].sort((a, b) => b.position - a.position);
    else if (order?.startsWith("position.asc")) selected = [...selected].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const limit = Number(url.searchParams.get("limit"));
    if (limit) selected = selected.slice(0, limit);
    if (table === "question_banks" && url.searchParams.get("select")?.includes("bank_questions(count)")) {
      selected = selected.map((row) => ({
        ...row,
        bank_questions: [{ count: String(database.bank_questions.filter((question) => question.bank_id === row.id && question.host_id === row.host_id).length) }],
      }));
    }
    return Response.json(selected);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { env, database, fetchMock, restUrls };
}

function send(env, token, path, method = "GET", body) {
  return handleApiRequest(new Request(`https://app.test${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

afterEach(() => vi.unstubAllGlobals());

describe("host-specific question bank Worker API", () => {
  it("creates a bank using the authenticated user ID and returns question counts", async () => {
    const { env, database } = createEnvironment();
    const created = await json(await send(env, "host-a-access-token-long", "/api/question-banks", "POST", {
      name: "Biology",
      description: "Cell science",
      host_id: HOST_B,
    }));
    expect(created.status).toBe(201);
    expect(database.question_banks[0]).toMatchObject({ host_id: HOST_A, name: "Biology", description: "Cell science" });
    expect(database.question_banks[0].host_id).not.toBe(HOST_B);
    const listed = await json(await send(env, "host-a-access-token-long", "/api/question-banks"));
    expect(listed.body).toMatchObject([{ id: created.body.id, name: "Biology", questionCount: 0 }]);
  });

  it("saves, loads, edits, duplicates, and deletes questions while preserving metadata", async () => {
    const { env, database } = createEnvironment();
    database.question_banks.push({ id: BANK_A, host_id: HOST_A, name: "Biology", description: "", created_at: "now", updated_at: "now" });
    const added = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/questions`, "POST", validQuestion));
    expect(added.status).toBe(201);
    expect(added.body.questionData).toMatchObject({ question: validQuestion.question, explanation: validQuestion.explanation, source: validQuestion.source });
    const questionId = added.body.id;
    const editedData = { ...validQuestion, question: "Name the molecule H2O." };
    const edited = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/questions/${questionId}`, "PATCH", { questionData: editedData }));
    expect(edited.body.questionData).toMatchObject({ question: editedData.question, source: validQuestion.source });
    const duplicated = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/questions/${questionId}/duplicate`, "POST"));
    expect(duplicated.status).toBe(201);
    expect(database.bank_questions).toHaveLength(2);
    const listed = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/questions`));
    expect(listed.body).toHaveLength(2);
    await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/questions/${questionId}`, "DELETE");
    expect(database.bank_questions).toHaveLength(1);
    expect(database.bank_questions[0].question_data.question).toBe(editedData.question);
  });

  it("prevents Host A from loading Host B's banks and questions", async () => {
    const { env, database, restUrls } = createEnvironment();
    database.question_banks.push({ id: BANK_B, host_id: HOST_B, name: "Private", description: "", created_at: "now", updated_at: "now" });
    database.bank_questions.push({ id: QUESTION_B, bank_id: BANK_B, host_id: HOST_B, question_data: validQuestion, position: 0 });
    expect((await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_B}`))).status).toBe(404);
    expect((await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_B}/questions`))).status).toBe(404);
    const hostABanks = await json(await send(env, "host-a-access-token-long", "/api/question-banks"));
    expect(hostABanks.body).toEqual([]);
    expect(restUrls.length).toBeGreaterThan(0);
    expect(restUrls.every((url) => url.includes(`host_id=eq.${HOST_A}`))).toBe(true);
  });

  it("rejects unauthenticated access before querying private bank data", async () => {
    const { env, fetchMock } = createEnvironment();
    await expect(send(env, undefined, "/api/question-banks")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("duplicates banks and cascades bank deletion to its saved questions", async () => {
    const { env, database } = createEnvironment();
    database.question_banks.push({ id: BANK_A, host_id: HOST_A, name: "Biology", description: "Basics", created_at: "now", updated_at: "now" });
    database.bank_questions.push({ id: QUESTION_A, bank_id: BANK_A, host_id: HOST_A, question_data: validQuestion, position: 0, created_at: "now", updated_at: "now" });
    const copy = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/duplicate`, "POST"));
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ name: "Copy of Biology", questionCount: 1 });
    const copyQuestion = database.bank_questions.find((question) => question.bank_id === copy.body.id);
    expect(copyQuestion.question_data).toEqual(validQuestion);
    await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}`, "DELETE");
    expect(database.bank_questions.some((question) => question.bank_id === BANK_A)).toBe(false);
    expect(database.bank_questions.some((question) => question.bank_id === copy.body.id)).toBe(true);
  });

  it("copies or moves only selected questions between banks owned by the host", async () => {
    const { env, database } = createEnvironment();
    database.question_banks.push(
      { id: BANK_A, host_id: HOST_A, name: "From", description: "", created_at: "now", updated_at: "now" },
      { id: BANK_B, host_id: HOST_A, name: "To", description: "", created_at: "now", updated_at: "now" },
    );
    database.bank_questions.push({ id: QUESTION_A, bank_id: BANK_A, host_id: HOST_A, question_data: validQuestion, position: 0 });
    const copied = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/transfer`, "POST", {
      targetBankId: BANK_B, mode: "copy", questionIds: [QUESTION_A],
    }));
    expect(copied.body.transferred).toBe(1);
    expect(database.bank_questions.filter((question) => question.bank_id === BANK_A)).toHaveLength(1);
    expect(database.bank_questions.filter((question) => question.bank_id === BANK_B)).toHaveLength(1);
    const moved = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/transfer`, "POST", {
      targetBankId: BANK_B, mode: "move", questionIds: [QUESTION_A],
    }));
    expect(moved.body.transferred).toBe(1);
    expect(database.bank_questions.filter((question) => question.bank_id === BANK_A)).toHaveLength(0);
    expect(database.bank_questions.filter((question) => question.bank_id === BANK_B)).toHaveLength(2);
  });

  it("imports question JSON and validates the existing MCQ shape", async () => {
    const { env, database } = createEnvironment();
    database.question_banks.push({ id: BANK_A, host_id: HOST_A, name: "Imported", description: "", created_at: "now", updated_at: "now" });
    const response = await json(await send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/import`, "POST", {
      questions: [validQuestion],
    }));
    expect(response.status).toBe(201);
    expect(response.body.imported).toBe(1);
    await expect(send(env, "host-a-access-token-long", `/api/question-banks/${BANK_A}/import`, "POST", {
      questions: [{ ...validQuestion, correct: "Not an option" }],
    })).rejects.toMatchObject({ status: 400 });
    expect(database.bank_questions).toHaveLength(1);
  });

  it("copies imported questions into a quiz draft without mutating bank data", () => {
    const saved = { ...validQuestion, options: [...validQuestion.options], source: { ...validQuestion.source } };
    const [draft] = cloneQuestionsForQuiz([saved]);
    draft.options[0] = "Changed in the quiz";
    draft.source.lesson = 10;
    expect(saved.options[0]).toBe("Water");
    expect(saved.source.lesson).toBe(4);
  });
});
