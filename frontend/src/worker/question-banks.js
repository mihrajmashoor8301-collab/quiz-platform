import { normalizeText } from "../durable-objects/quiz-room-core.js";
import { HttpError, jsonResponse, readJson, supabaseRest } from "./supabase.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BANKS = 500;
const MAX_QUESTIONS_PER_BANK = 500;
const MAX_IMPORTED_QUESTIONS = 100;
const MAX_QUESTION_DATA_BYTES = 16 * 1024;

function validId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function userFilter(userId) {
  return `host_id=eq.${encodeURIComponent(userId)}`;
}

function bankPath(bankId, query = "") {
  return `question_banks?id=eq.${encodeURIComponent(bankId)}&${query}`;
}

function questionPath(bankId, userId, extra = "") {
  return `bank_questions?bank_id=eq.${encodeURIComponent(bankId)}&${userFilter(userId)}${extra ? `&${extra}` : ""}`;
}

function validateBank(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (name.length < 1 || name.length > 80) throw new HttpError(400, "Bank name must be 1 to 80 characters.");
  if (description.length > 500) throw new HttpError(400, "Bank description must be 500 characters or fewer.");
  return { name, description };
}

export function validateBankQuestion(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Question must be an object.");
  }
  const rawQuestion = input.question ?? input.text;
  if (typeof rawQuestion !== "string") throw new HttpError(400, "Question text must be a string.");
  const question = rawQuestion.trim();
  const options = Array.isArray(input.options)
    ? input.options.map((option) => typeof option === "string" ? option.trim() : "")
    : [];
  const correct = typeof input.correct === "string" ? input.correct.trim() : "";
  const timeLimit = Number(input.timeLimit ?? 20);
  if (!question || question.length > 500) throw new HttpError(400, "Question text must be 1 to 500 characters.");
  if (options.length < 2 || options.length > 8 || options.some((option) => !option || option.length > 200)) {
    throw new HttpError(400, "Each question needs 2 to 8 non-empty options, each at most 200 characters.");
  }
  if (new Set(options.map(normalizeText)).size !== options.length) {
    throw new HttpError(400, "Question options must be unique.");
  }
  if (!options.some((option) => normalizeText(option) === normalizeText(correct))) {
    throw new HttpError(400, "Correct answer must match one of the question options.");
  }
  if (!Number.isInteger(timeLimit) || timeLimit < 5 || timeLimit > 120) {
    throw new HttpError(400, "Question timer must be from 5 to 120 seconds.");
  }

  let questionData;
  try {
    questionData = JSON.parse(JSON.stringify({ ...input, question, options, correct, timeLimit }));
  } catch {
    throw new HttpError(400, "Question metadata must be valid JSON.");
  }
  if (typeof questionData.explanation === "string" && questionData.explanation.length > 4000) {
    throw new HttpError(400, "Question explanation must be 4,000 characters or fewer.");
  }
  if (questionData.explanation !== undefined && typeof questionData.explanation !== "string") {
    throw new HttpError(400, "Question explanation must be text.");
  }
  if (new TextEncoder().encode(JSON.stringify(questionData)).byteLength > MAX_QUESTION_DATA_BYTES) {
    throw new HttpError(400, "Question data is too large.");
  }
  return questionData;
}

function bankView(row) {
  const relation = row.bank_questions;
  const questionCount = Array.isArray(relation) ? Number(relation[0]?.count || 0) : 0;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    questionCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function questionView(row) {
  return {
    id: row.id,
    bankId: row.bank_id,
    questionData: row.question_data,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ownedBank(env, bankId, userId) {
  const rows = await supabaseRest(env,
    `question_banks?id=eq.${encodeURIComponent(bankId)}&${userFilter(userId)}&select=id,host_id,name,description,created_at,updated_at&limit=1`
  );
  return rows?.[0] || null;
}

async function touchBank(env, bankId, userId) {
  await supabaseRest(env,
    `question_banks?id=eq.${encodeURIComponent(bankId)}&${userFilter(userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    }
  );
}

async function listQuestions(env, bankId, userId) {
  return supabaseRest(env,
    `${questionPath(bankId, userId, "select=id,bank_id,question_data,position,created_at,updated_at")}&order=position.asc,id.asc&limit=${MAX_QUESTIONS_PER_BANK}`
  );
}

async function insertQuestions(env, bankId, userId, questionDataList) {
  const current = await supabaseRest(env,
    `${questionPath(bankId, userId, "select=id,position")}&order=position.desc&limit=${MAX_QUESTIONS_PER_BANK + 1}`
  );
  if (current.length + questionDataList.length > MAX_QUESTIONS_PER_BANK) {
    throw new HttpError(400, `A bank can contain at most ${MAX_QUESTIONS_PER_BANK} questions.`);
  }
  const position = current.length ? Math.max(...current.map((row) => Number(row.position) || 0)) + 1 : 0;
  const rows = await supabaseRest(env, "bank_questions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(questionDataList.map((questionData, index) => ({
      bank_id: bankId,
      host_id: userId,
      question_data: questionData,
      position: position + index,
    }))),
  });
  await touchBank(env, bankId, userId);
  return (rows || []).map(questionView);
}

async function handleBankCollection(request, env, user, limit) {
  if (request.method === "GET") {
    await limit(`bank-read:${user.id}`, 120, 60_000);
    const rows = await supabaseRest(env,
      `question_banks?${userFilter(user.id)}&select=id,name,description,created_at,updated_at,bank_questions(count)&order=updated_at.desc&limit=${MAX_BANKS}`
    );
    return jsonResponse((rows || []).map(bankView));
  }
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  await limit(`bank-write:${user.id}`, 60, 60_000);
  const bank = validateBank(await readJson(request, 16 * 1024));
  const existing = await supabaseRest(env,
    `question_banks?${userFilter(user.id)}&select=id&limit=${MAX_BANKS + 1}`
  );
  if (existing.length >= MAX_BANKS) throw new HttpError(400, `A host can create at most ${MAX_BANKS} banks.`);
  const rows = await supabaseRest(env, "question_banks", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...bank, host_id: user.id }),
  });
  return jsonResponse(bankView(rows[0]), 201);
}

async function handleBank(request, env, user, bankId, action, limit) {
  if (!validId(bankId)) return jsonResponse({ error: "Question bank not found." }, 404);
  await limit(`bank-write:${user.id}`, 60, 60_000);
  const bank = await ownedBank(env, bankId, user.id);
  if (!bank) return jsonResponse({ error: "Question bank not found." }, 404);

  if (!action && request.method === "PATCH") {
    const values = validateBank(await readJson(request, 16 * 1024));
    const rows = await supabaseRest(env,
      `${bankPath(bankId, userFilter(user.id))}&select=id,name,description,created_at,updated_at,bank_questions(count)`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
      }
    );
    return rows?.[0] ? jsonResponse(bankView(rows[0])) : jsonResponse({ error: "Question bank not found." }, 404);
  }
  if (!action && request.method === "DELETE") {
    const rows = await supabaseRest(env,
      `${bankPath(bankId, userFilter(user.id))}&select=id`,
      { method: "DELETE", headers: { Prefer: "return=representation" } }
    );
    return rows?.length ? jsonResponse({ deleted: true, id: bankId }) : jsonResponse({ error: "Question bank not found." }, 404);
  }
  if (action === "duplicate" && request.method === "POST") {
    const sourceQuestions = await listQuestions(env, bankId, user.id);
    const copyName = `Copy of ${bank.name}`.slice(0, 80);
    const created = await supabaseRest(env, "question_banks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ host_id: user.id, name: copyName, description: bank.description || "" }),
    });
    const duplicate = created?.[0];
    if (!duplicate) throw new HttpError(503, "Could not duplicate the question bank.");
    try {
      const copiedQuestions = sourceQuestions.length
        ? await insertQuestions(env, duplicate.id, user.id, sourceQuestions.map((row) => validateBankQuestion(row.question_data)))
        : [];
      return jsonResponse({ ...bankView(duplicate), questionCount: copiedQuestions.length }, 201);
    } catch (error) {
      await supabaseRest(env, `${bankPath(duplicate.id, userFilter(user.id))}`, { method: "DELETE" }).catch(() => {});
      throw error;
    }
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleBankQuestions(request, env, user, bankId, questionId, action, limit) {
  if (!validId(bankId)) return jsonResponse({ error: "Question bank not found." }, 404);
  if (request.method === "GET" && !questionId) {
    await limit(`bank-read:${user.id}`, 120, 60_000);
    if (!(await ownedBank(env, bankId, user.id))) return jsonResponse({ error: "Question bank not found." }, 404);
    const rows = await listQuestions(env, bankId, user.id);
    return jsonResponse((rows || []).map(questionView));
  }
  await limit(`bank-write:${user.id}`, 60, 60_000);
  if (!(await ownedBank(env, bankId, user.id))) return jsonResponse({ error: "Question bank not found." }, 404);

  if (request.method === "POST" && action === "import" && !questionId) {
    const body = await readJson(request, 512 * 1024);
    if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > MAX_IMPORTED_QUESTIONS) {
      throw new HttpError(400, `Import between 1 and ${MAX_IMPORTED_QUESTIONS} questions at a time.`);
    }
    const questionData = body.questions.map(validateBankQuestion);
    const rows = await insertQuestions(env, bankId, user.id, questionData);
    return jsonResponse({ imported: rows.length, questions: rows }, 201);
  }
  if (request.method === "POST" && !questionId) {
    const body = await readJson(request, 24 * 1024);
    const rows = await insertQuestions(env, bankId, user.id, [validateBankQuestion(body.questionData ?? body)]);
    return jsonResponse(rows[0], 201);
  }
  if (!validId(questionId)) return jsonResponse({ error: "Question not found." }, 404);
  const filter = `id=eq.${encodeURIComponent(questionId)}`;
  if (request.method === "POST" && action === "duplicate") {
    const source = await supabaseRest(env,
      `${questionPath(bankId, user.id, `select=question_data&${filter}`)}&limit=1`
    );
    if (!source?.[0]) return jsonResponse({ error: "Question not found." }, 404);
    const rows = await insertQuestions(env, bankId, user.id, [validateBankQuestion(source[0].question_data)]);
    return jsonResponse(rows[0], 201);
  }
  if (request.method === "PATCH" && !action) {
    const body = await readJson(request, 24 * 1024);
    const questionData = validateBankQuestion(body.questionData ?? body);
    const rows = await supabaseRest(env,
      `${questionPath(bankId, user.id, `select=id,bank_id,question_data,position,created_at,updated_at&${filter}`)}&limit=1`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ question_data: questionData, updated_at: new Date().toISOString() }),
      }
    );
    if (rows?.length) await touchBank(env, bankId, user.id);
    return rows?.[0] ? jsonResponse(questionView(rows[0])) : jsonResponse({ error: "Question not found." }, 404);
  }
  if (request.method === "DELETE" && !action) {
    const rows = await supabaseRest(env,
      `${questionPath(bankId, user.id, `select=id&${filter}`)}&limit=1`,
      { method: "DELETE", headers: { Prefer: "return=representation" } }
    );
    if (rows?.length) await touchBank(env, bankId, user.id);
    return rows?.length ? jsonResponse({ deleted: true, id: questionId }) : jsonResponse({ error: "Question not found." }, 404);
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleTransfer(request, env, user, sourceBankId, limit) {
  await limit(`bank-write:${user.id}`, 60, 60_000);
  if (!validId(sourceBankId)) return jsonResponse({ error: "Question bank not found." }, 404);
  const body = await readJson(request, 24 * 1024);
  const targetBankId = body.targetBankId;
  const mode = body.mode;
  const ids = Array.isArray(body.questionIds) ? [...new Set(body.questionIds)] : [];
  if (!validId(targetBankId) || !["copy", "move"].includes(mode) || ids.length < 1 || ids.length > 100 || ids.some((id) => !validId(id))) {
    throw new HttpError(400, "Select 1 to 100 questions and choose a valid destination and copy or move action.");
  }
  if (sourceBankId === targetBankId) throw new HttpError(400, "Choose a different destination bank.");
  if (!(await ownedBank(env, sourceBankId, user.id)) || !(await ownedBank(env, targetBankId, user.id))) {
    return jsonResponse({ error: "Question bank not found." }, 404);
  }
  const filter = `id=in.(${ids.map(encodeURIComponent).join(",")})`;
  const rows = await supabaseRest(env,
    `${questionPath(sourceBankId, user.id, `select=id,bank_id,question_data,position&${filter}`)}&limit=${ids.length}`
  );
  if (rows.length !== ids.length) return jsonResponse({ error: "One or more questions were not found in that bank." }, 404);
  if (mode === "copy") {
    const inserted = await insertQuestions(env, targetBankId, user.id, rows.map((row) => validateBankQuestion(row.question_data)));
    return jsonResponse({ transferred: inserted.length, mode });
  }
  const moved = await supabaseRest(env,
    `${questionPath(sourceBankId, user.id, `select=id&${filter}`)}&limit=${ids.length}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ bank_id: targetBankId, updated_at: new Date().toISOString() }),
    }
  );
  if (moved.length) {
    await touchBank(env, sourceBankId, user.id);
    await touchBank(env, targetBankId, user.id);
  }
  return jsonResponse({ transferred: moved.length, mode });
}

export async function handleQuestionBankRequest(request, env, user, rateLimit) {
  const url = new URL(request.url);
  const prefix = "/api/question-banks";
  const path = url.pathname.slice(prefix.length).split("/").filter(Boolean);
  if (path.length === 0) return handleBankCollection(request, env, user, rateLimit);
  const [bankId, action, questionId, questionAction] = path;
  if (!validId(bankId)) return jsonResponse({ error: "Question bank not found." }, 404);
  if (path.length === 1) return handleBank(request, env, user, bankId, undefined, rateLimit);
  if (action === "duplicate" && path.length === 2) return handleBank(request, env, user, bankId, action, rateLimit);
  if (action === "transfer" && path.length === 2 && request.method === "POST") return handleTransfer(request, env, user, bankId, rateLimit);
  if (action === "import" && path.length === 2 && request.method === "POST") return handleBankQuestions(request, env, user, bankId, undefined, "import", rateLimit);
  if (action === "questions" && path.length === 2) return handleBankQuestions(request, env, user, bankId, undefined, undefined, rateLimit);
  if (action === "questions" && path.length === 3) return handleBankQuestions(request, env, user, bankId, questionId, undefined, rateLimit);
  if (action === "questions" && path.length === 4 && questionAction === "duplicate") {
    return handleBankQuestions(request, env, user, bankId, questionId, "duplicate", rateLimit);
  }
  return jsonResponse({ error: "Not found." }, 404);
}
