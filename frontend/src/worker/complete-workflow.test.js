import { describe, expect, it, vi } from "vitest";
import { handleApiRequest } from "./api.js";
import { createRoomState, QuizRoomCore } from "../durable-objects/quiz-room-core.js";
import { cloneQuestionsForQuiz } from "../lib/question-bank-utils.ts";

const HOST_ID = "f5e7eb32-df63-4c7f-8de8-b8f540bc854c";
const HOST_TOKEN = "host-full-workflow-token-123456";

describe("Phase 10 — Complete 14-Step End-to-End Workflow Verification", () => {
  it("executes the full host and player lifecycle seamlessly", async () => {
    // 1. Host Authentication Mocking & Environment Setup
    const database = { question_banks: [], bank_questions: [], quizzes: [], rooms: [] };
    let sequence = 1;
    const newId = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;

    const env = {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "public-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      ROOMS: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async (url) => {
            const path = new URL(url).pathname;
            if (path === "/__rate-limit") return Response.json({ allowed: true });
            if (path === "/internal/init") return Response.json({ status: "lobby" }, { status: 201 });
            return Response.json({ allowed: true });
          },
        }),
      },
    };

    let activeSavedQuiz = null;

    const fetchMock = vi.fn(async (input, init = {}) => {
      const url = new URL(input);
      if (url.pathname === "/auth/v1/user") {
        const token = init.headers?.authorization?.replace(/^Bearer\s+/i, "");
        if (token === HOST_TOKEN) {
          return Response.json({ id: HOST_ID, email: "alex@example.test" });
        }
        return new Response("{}", { status: 401 });
      }

      if (url.pathname === "/rest/v1/quizzes") {
        if (init.method === "POST") {
          activeSavedQuiz = JSON.parse(init.body);
          return Response.json([activeSavedQuiz], { status: 201 });
        }
        return Response.json(
          activeSavedQuiz
            ? [{ id: "quiz-1", owner_id: HOST_ID, ...activeSavedQuiz }]
            : []
        );
      }

      if (url.pathname === "/rest/v1/rooms") {
        if (init.method === "POST") {
          const created = JSON.parse(init.body);
          return Response.json([{ ...created }], { status: 201 });
        }
        return Response.json([]);
      }

      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.slice("/rest/v1/".length);
        const rows = database[table] || [];

        const matches = (row) => {
          for (const key of ["id", "host_id", "bank_id"]) {
            const value = url.searchParams.get(key);
            if (!value) continue;
            if (value.startsWith("eq.") && row[key] !== value.slice(3)) return false;
          }
          return true;
        };

        const method = init.method || "GET";
        if (method === "POST") {
          const payload = JSON.parse(init.body);
          const inserted = (Array.isArray(payload) ? payload : [payload]).map((item) => {
            const row = { id: newId(), ...item };
            rows.push(row);
            return row;
          });
          return Response.json(inserted, { status: 201 });
        }

        if (table === "question_banks" && url.searchParams.get("select")?.includes("bank_questions(count)")) {
          return Response.json(
            rows.filter(matches).map((row) => ({
              ...row,
              bank_questions: [{ count: database.bank_questions.filter((q) => q.bank_id === row.id).length }],
            }))
          );
        }

        return Response.json(rows.filter(matches));
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Step 1: Host logs in and creates a Cybersecurity Question Bank
    const createBankRes = await handleApiRequest(
      new Request("https://app.test/api/question-banks", {
        method: "POST",
        headers: { authorization: `Bearer ${HOST_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Cybersecurity Fundamentals", description: "Security trivia bank" }),
      }),
      env
    );
    expect(createBankRes.status).toBe(201);
    const cyberBank = await createBankRes.json();
    expect(cyberBank.name).toBe("Cybersecurity Fundamentals");

    // Step 2 & 3: Opens Question Bank and imports cybersecurity questions via JSON
    const cybersecurityQuestions = [
      {
        question: "Which type of cyber attack involves intercepting communications?",
        options: ["Man-in-the-Middle (MitM)", "SQL Injection", "Cross-Site Scripting (XSS)", "Buffer Overflow"],
        correct: "Man-in-the-Middle (MitM)",
        timeLimit: 20,
        explanation: "MitM intercepts data between sender and receiver.",
      },
      {
        question: "What does TLS stand for in web security?",
        options: ["Transport Layer Security", "Targeted Link Shield", "Total Layer Segmentation", "Terminal Logic System"],
        correct: "Transport Layer Security",
        timeLimit: 15,
        explanation: "TLS secures internet communications.",
      },
    ];

    const importRes = await handleApiRequest(
      new Request(`https://app.test/api/question-banks/${cyberBank.id}/import`, {
        method: "POST",
        headers: { authorization: `Bearer ${HOST_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ questions: cybersecurityQuestions }),
      }),
      env
    );
    expect(importRes.status).toBe(201);
    const importData = await importRes.json();
    expect(importData.imported).toBe(2);

    // Step 4: Saves questions & creates a second bank (Web Engineering)
    const createBank2Res = await handleApiRequest(
      new Request("https://app.test/api/question-banks", {
        method: "POST",
        headers: { authorization: `Bearer ${HOST_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Web Engineering", description: "Frontend and HTTP trivia" }),
      }),
      env
    );
    const webBank = await createBank2Res.json();

    await handleApiRequest(
      new Request(`https://app.test/api/question-banks/${webBank.id}/questions`, {
        method: "POST",
        headers: { authorization: `Bearer ${HOST_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          questionData: {
            question: "What is the purpose of HTTP 200 OK?",
            options: ["Successful request", "Not found", "Unauthorized", "Server error"],
            correct: "Successful request",
            timeLimit: 20,
          },
        }),
      }),
      env
    );

    // Step 5 & 6: Creates a quiz and selects questions from multiple banks
    const bank1QuestionsRes = await handleApiRequest(
      new Request(`https://app.test/api/question-banks/${cyberBank.id}/questions`, {
        headers: { authorization: `Bearer ${HOST_TOKEN}` },
      }),
      env
    );
    const bank1Questions = await bank1QuestionsRes.json();

    const bank2QuestionsRes = await handleApiRequest(
      new Request(`https://app.test/api/question-banks/${webBank.id}/questions`, {
        headers: { authorization: `Bearer ${HOST_TOKEN}` },
      }),
      env
    );
    const bank2Questions = await bank2QuestionsRes.json();

    const combinedQuestions = cloneQuestionsForQuiz([
      bank1Questions[0].questionData,
      bank2Questions[0].questionData,
    ]);
    expect(combinedQuestions).toHaveLength(2);
    expect(combinedQuestions[0].question).toBe("Which type of cyber attack involves intercepting communications?");
    expect(combinedQuestions[1].question).toBe("What is the purpose of HTTP 200 OK?");

    // Step 7: Saves the quiz
    activeSavedQuiz = {
      title: "Multi-Topic Security & Web Quiz",
      max_participants: 20,
      questions: combinedQuestions,
    };

    // Step 8: Launches the lobby (Creates room PIN)
    const createRoomRes = await handleApiRequest(
      new Request("https://app.test/api/rooms", {
        method: "POST",
        headers: { authorization: `Bearer ${HOST_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Multi-Topic Security & Web Quiz",
          maxParticipants: 20,
        }),
      }),
      env
    );
    expect(createRoomRes.status).toBe(201);
    const roomData = await createRoomRes.json();
    expect(roomData.pin).toMatch(/^\d{6}$/);

    // Step 9: Player joins using the PIN
    const roomState = createRoomState(
      {
        pin: roomData.pin,
        quizId: "quiz-workflow-1",
        hostId: HOST_ID,
        title: "Multi-Topic Security & Web Quiz",
        maxParticipants: 20,
      },
      combinedQuestions,
      1000
    );
    const core = new QuizRoomCore(roomState, () => 1000);

    const player1 = core.addPlayer({ id: "p1-uuid", nickname: "Alice", sessionHash: "hash-alice" });
    const player2 = core.addPlayer({ id: "p2-uuid", nickname: "Bob", sessionHash: "hash-bob" });
    expect(player1.nickname).toBe("Alice");
    expect(player2.nickname).toBe("Bob");
    expect(core.state.players).toHaveLength(2);

    // Step 10: Host starts the quiz
    core.startQuiz(HOST_ID);
    expect(core.state.questionState).toBe("question");
    expect(core.state.currentQuestionIndex).toBe(0);

    const playerPayload = core.currentQuestionPayload();
    expect(playerPayload.text).toBe("Which type of cyber attack involves intercepting communications?");
    expect(playerPayload).not.toHaveProperty("correct");

    // Step 11: Player answers questions
    // Alice answers correctly
    core.submitAnswer("p1-uuid", {
      questionId: 1,
      answer: "Man-in-the-Middle (MitM)",
    });

    // Bob answers incorrectly
    const events = core.submitAnswer("p2-uuid", {
      questionId: 1,
      answer: "SQL Injection",
    });

    // Step 12 & 13: Timer, transitions, and scoring
    const resultsEvent = events.find((e) => e.event === "question-results");
    expect(resultsEvent).toBeDefined();
    expect(resultsEvent.data.correctAnswers).toEqual(["Man-in-the-Middle (MitM)"]);

    const aliceScore = resultsEvent.data.leaderboard.find((p) => p.id === "p1-uuid");
    const bobScore = resultsEvent.data.leaderboard.find((p) => p.id === "p2-uuid");
    expect(aliceScore.score).toBeGreaterThan(1000);
    expect(bobScore.score).toBe(0);

    // Step 14: Results and leaderboard appear -> Next question and finale
    core.nextQuestion(HOST_ID);
    expect(core.state.currentQuestionIndex).toBe(1);

    core.submitAnswer("p1-uuid", { questionId: 2, answer: "Successful request" });
    core.submitAnswer("p2-uuid", { questionId: 2, answer: "Successful request" });

    const finishEvents = core.nextQuestion(HOST_ID);
    const quizFinished = finishEvents.find((e) => e.event === "quiz-finished");
    expect(quizFinished).toBeDefined();
    expect(quizFinished.data.leaderboard[0].nickname).toBe("Alice");
    expect(quizFinished.data.leaderboard[1].nickname).toBe("Bob");
  });
});
