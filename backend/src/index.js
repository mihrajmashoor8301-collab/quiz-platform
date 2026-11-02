import { execSync } from "node:child_process";
import os from "node:os";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

import { JOIN_ERRORS } from "./constants.js";
import { rateLimiter } from "./rate-limiter.js";
import log from "./logger.js";
import LiveGame from "./services/live-game.js";
import RoomService from "./services/room.service.js";
import { getFakeBackend } from "../test/fakes.js";
import { recordHost, getRoomService } from "./services/backends.js";
import version from "./version.js";

const rooms = new Map(); // PIN -> roomService
const games = new Map(); // PIN -> LiveGame
const activeQuizzes = new Map(); // PIN -> QuizState
const recursion = { current: 0 };

const HTTP_PORT = Number(process.env.PORT || process.env.HTTP_PORT || 3000);
const HTTP_HOST = process.env.HOST || process.env.HTTP_HOST || "0.0.0.0";
const ALLOWED_ENV = (
  process.env.ALLOWED_ENV ||
  "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
)
  .split(",")
  .map((s) => s.trim());

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: false,
  })
);
// Explicitly clear any client browser HSTS caching for localhost
app.use((_req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=0");
  next();
});
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ENV.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

let currentListeningPort = HTTP_PORT;

export function start(port) {
  let chosenPort = port || Number(process.env.PORT || 0);
  if (!chosenPort || process.env.VITEST || process.env.NODE_ENV === "test") {
    try {
      const freePortStr = execSync(
        "node -e 'const net = require(\"node:net\"); const s = net.createServer(); s.listen(0, \"127.0.0.1\", () => { console.log(s.address().port); s.close(); });'",
        { encoding: "utf8" }
      ).trim();
      chosenPort = Number(freePortStr) || 3001;
    } catch {
      chosenPort = 3001;
    }
  }
  currentListeningPort = chosenPort;
  if (!httpServer.listening) {
    httpServer.listen(chosenPort, "127.0.0.1");
  }
  return { address: "127.0.0.1", port: chosenPort, family: "IPv4" };
}

function getQuizState(pin) {
  let state = activeQuizzes.get(pin);
  if (!state) {
    state = {
      pin,
      questions: [],
      currentQuestionIndex: -1,
      questionState: "lobby", // lobby, question, results, finished
      participants: new Map(), // socketId -> { socketId, nickname, score, hasAnswered, lastAnswer, isCorrect }
      hostSocketId: null,
      timer: null,
      questionStartTime: 0,
      timeRemaining: 0,
    };
    activeQuizzes.set(pin, state);
  }
  return state;
}

function getGame(pin) {
  let game = games.get(pin);
  if (!game) {
    const service = rooms.get(pin);
    game = new LiveGame({
      questionService: service?.questionService,
      pool: service?.pool,
    });
    games.set(pin, game);
  }
  return game;
}

export async function setup(ioInstance) {
  if (!httpServer.listening) {
    await new Promise((resolve) => {
      httpServer.listen(currentListeningPort, "127.0.0.1", resolve);
    });
  } else if (!httpServer.address()) {
    await new Promise((resolve) => {
      httpServer.once("listening", resolve);
    });
  }
  const backend = getFakeBackend();
  const roomService = new RoomService(backend, httpServer);
  roomService.backend = backend;
  backend.roomService = roomService;
  rooms.set(backend.pin, roomService);
  return { io: ioInstance || io, rooms, games };
}

app.get("/health", (_req, res) => {
  res.json({ name: version, status: "ok" });
});

app.get("/network-info", (_req, res) => {
  const ifaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const iface of list) {
      if (iface.family === "IPv4" && !iface.internal) {
        const isVirtual = name.startsWith("docker") || name.startsWith("br-") || name.startsWith("veth");
        addresses.push({ name, address: iface.address, isVirtual });
      }
    }
  }
  addresses.sort((a, b) => (a.isVirtual ? 1 : 0) - (b.isVirtual ? 1 : 0));
  const primaryIp = addresses[0]?.address || "127.0.0.1";
  res.json({
    primaryIp,
    addresses,
    port: HTTP_PORT,
    wifiUrl: `http://${primaryIp}:${HTTP_PORT}`,
  });
});

app.post("/rooms", async (req, res) => {
  const hostId = uuidv4();
  const { title, maxParticipants } = req.body;
  if (!title || typeof title !== "string" || title.trim().length < 3) {
    return res.status(400).json({ error: "title is required (min 3 chars)" });
  }
  if (
    maxParticipants !== undefined &&
    (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 200)
  ) {
    return res.status(400).json({ error: "maxParticipants must be between 1 and 200" });
  }

  const service = await getRoomService(httpServer, null);
  const room = await service.create({
    hostId,
    title: title.trim(),
    maxParticipants: maxParticipants ?? 200,
  });
  service.hostId = hostId;
  rooms.set(room.pin, service);
  recordHost(room.pin, hostId);

  const quiz = getQuizState(room.pin);
  quiz.title = room.title;

  res.status(201).json(room);
});

app.get("/rooms/:pin", async (req, res) => {
  const { pin } = req.params;
  const service = rooms.get(pin) || (await getRoomService(httpServer, pin));
  if (!service || !service.room) {
    return res.status(404).json({ error: "room not found" });
  }
  const quiz = getQuizState(pin);
  res.json({
    id: service.room.id,
    pin: service.room.pin,
    title: service.room.title,
    status: service.room.status,
    currentParticipants: quiz.participants.size || service.room.currentParticipants || 0,
    maxParticipants: service.room.maxParticipants,
    questionState: quiz.questionState,
  });
});

app.get("/rooms/:pin/questions", async (req, res) => {
  const { pin } = req.params;
  const quiz = getQuizState(pin);
  res.json(quiz.questions);
});

app.post("/rooms/:pin/questions", async (req, res) => {
  const { pin } = req.params;
  const { type = "mcq", question, options = [], timeLimit = 30, correct = [], promptText: bodyPromptText } = req.body;
  const service = rooms.get(pin) || (await getRoomService(httpServer, pin));
  if (!service || !service.room) {
    return res.status(404).json({ error: "room not found" });
  }
  if (!question && !bodyPromptText) {
    return res.status(400).json({ error: "question is required" });
  }

  const promptText = bodyPromptText || (typeof question === "string" ? question : question?.text) || "Question";
  if (type === "poll" && !promptText) {
    return res.status(400).json({ error: "promptText is required for polls" });
  }

  const rawCorrect = Array.isArray(correct) ? correct.flat(Infinity) : [correct];
  const cleanCorrect = rawCorrect
    .filter((c) => c !== undefined && c !== null && String(c).trim().length > 0)
    .map((c) => String(c).trim());

  const questionObj = {
    id: (quizQuestionsCount(pin) || 0) + 1,
    roomId: service.room.id,
    creatorId: service.hostId ?? 1,
    type,
    text: promptText,
    question: { text: promptText },
    options: Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [],
    timeLimit: Number(timeLimit) || 30,
    correct: cleanCorrect.length > 0 ? cleanCorrect : (options[0] ? [String(options[0]).trim()] : ["Option 1"]),
    status: "queued",
    createdAt: new Date(),
  };

  const quiz = getQuizState(pin);
  quiz.questions.push(questionObj);

  await service.questionService.create({
    roomId: service.room.id,
    creatorId: service.hostId ?? 1,
    type,
    question: { text: promptText },
    options: questionObj.options,
    timeLimit: questionObj.timeLimit,
  });

  res.json(questionObj);
});

function quizQuestionsCount(pin) {
  return activeQuizzes.get(pin)?.questions?.length || 0;
}

// -------------------------------------------------------------
// Live Game Loop Functions
// -------------------------------------------------------------
function startQuestion(pin, index) {
  const quiz = getQuizState(pin);
  if (!quiz || index >= quiz.questions.length) return;

  quiz.currentQuestionIndex = index;
  quiz.questionState = "question";
  quiz.questionStartTime = Date.now();

  const q = quiz.questions[index];
  q.status = "active";

  for (const p of quiz.participants.values()) {
    p.hasAnswered = false;
    p.lastAnswer = null;
    p.isCorrect = false;
  }

  if (quiz.timer) {
    clearInterval(quiz.timer);
    quiz.timer = null;
  }

  quiz.timeRemaining = q.timeLimit || 30;

  io.to(pin).emit("question-started", {
    index,
    total: quiz.questions.length,
    id: q.id,
    text: q.text,
    options: q.options,
    timeLimit: q.timeLimit,
    timeRemaining: quiz.timeRemaining,
  });

  quiz.timer = setInterval(() => {
    quiz.timeRemaining -= 1;
    io.to(pin).emit("timer-tick", { timeRemaining: quiz.timeRemaining });

    if (quiz.timeRemaining <= 0) {
      clearInterval(quiz.timer);
      quiz.timer = null;
      closeQuestion(pin);
    }
  }, 1000);
}

function closeQuestion(pin) {
  const quiz = getQuizState(pin);
  if (!quiz || quiz.questionState === "results") return;

  if (quiz.timer) {
    clearInterval(quiz.timer);
    quiz.timer = null;
  }

  quiz.questionState = "results";
  const q = quiz.questions[quiz.currentQuestionIndex];
  if (!q) return;
  q.status = "closed";

  const rawCorrect = Array.isArray(q.correct) ? q.correct.flat(Infinity) : [q.correct];
  const correctAnswers = rawCorrect
    .filter((c) => c !== undefined && c !== null)
    .map((c) => String(c).trim());
  const norm = (s) => String(s ?? "").trim().toLowerCase();

  const optionCounts = {};
  for (const opt of q.options) {
    optionCounts[opt] = 0;
  }

  for (const p of quiz.participants.values()) {
    if (p.lastAnswer) {
      optionCounts[p.lastAnswer] = (optionCounts[p.lastAnswer] || 0) + 1;
      const isCorrect = correctAnswers.some((c) => norm(c) === norm(p.lastAnswer));
      if (isCorrect) {
        p.isCorrect = true;
        const speedBonus = Math.max(0, Math.round(quiz.timeRemaining * 15));
        p.score += 1000 + speedBonus;
      } else {
        p.isCorrect = false;
      }
    } else {
      p.isCorrect = false;
    }
  }

  const leaderboard = Array.from(quiz.participants.values())
    .map((p) => ({
      id: p.socketId,
      nickname: p.nickname,
      score: p.score,
      isCorrect: p.isCorrect,
    }))
    .sort((a, b) => b.score - a.score);

  io.to(pin).emit("question-results", {
    questionId: q.id,
    correctAnswers,
    optionCounts,
    leaderboard,
    hasNext: quiz.currentQuestionIndex < quiz.questions.length - 1,
  });
}

function finishQuiz(pin) {
  const quiz = getQuizState(pin);
  if (!quiz) return;

  quiz.questionState = "finished";
  if (quiz.timer) {
    clearInterval(quiz.timer);
    quiz.timer = null;
  }

  const leaderboard = Array.from(quiz.participants.values())
    .map((p) => ({
      id: p.socketId,
      nickname: p.nickname,
      score: p.score,
    }))
    .sort((a, b) => b.score - a.score);

  const service = rooms.get(pin);
  if (service) {
    service.finish();
  }

  io.to(pin).emit("quiz-finished", {
    leaderboard,
  });
}

// -------------------------------------------------------------
// Socket Connection Handlers
// -------------------------------------------------------------
io.on("connection", (socket) => {
  log.info(`connected ${socket.id}`);

  const onJoin = async (data, callback) => {
    recursion.current += 1;
    if (recursion.current > 20) {
      recursion.current -= 1;
      if (callback) callback("too many reconnections");
      return socket.emit("error", "too many reconnections");
    }
    try {
      await onJoinRoom(socket, data, callback);
    } finally {
      recursion.current -= 1;
    }
  };

  socket.on("join-room", onJoin);
  socket.on("join:room", onJoin);

  socket.on("start-quiz", () => {
    const { rid } = socket.data || {};
    if (!rid) return;
    const quiz = getQuizState(rid);
    if (!quiz.questions || quiz.questions.length === 0) {
      return socket.emit("error", "No questions available in this room");
    }
    startQuestion(rid, 0);
  });

  socket.on("close-question", () => {
    const { rid } = socket.data || {};
    if (rid) closeQuestion(rid);
  });

  socket.on("finish-quiz", () => {
    const { rid } = socket.data || {};
    if (rid) finishQuiz(rid);
  });

  socket.on("next-question", () => {
    const { rid } = socket.data || {};
    if (!rid) return;
    const quiz = getQuizState(rid);
    const nextIndex = quiz.currentQuestionIndex + 1;
    if (nextIndex < quiz.questions.length) {
      startQuestion(rid, nextIndex);
    } else {
      finishQuiz(rid);
    }
  });

  socket.on("submit-answer", async (data) => {
    recursion.current += 1;
    try {
      await handleAnswer(socket, data);
    } finally {
      recursion.current -= 1;
    }
  });

  socket.on("disconnect", () => {
    log.info(`disconnected ${socket.id}`);
    const { rid, pid } = socket.data || {};
    if (rid && pid) {
      const quiz = activeQuizzes.get(rid);
      if (quiz) {
        quiz.participants.delete(pid);
        const playersList = Array.from(quiz.participants.values()).map((p) => ({
          id: p.socketId,
          nickname: p.nickname,
          score: p.score,
        }));
        io.to(rid).emit("player-list", {
          players: playersList,
          count: playersList.length,
        });
      }
    }
  });
});

async function onJoinRoom(socket, data, callback) {
  // Check if this socket has already joined a room
  if (socket.data?.rid) {
    if (callback) callback("socket already joined to room " + socket.data.rid);
    return socket.emit("error", "already in a room");
  }

  const roomPin = typeof data === "string" ? data : (data?.pin || data?.roomPin);
  const nickname = typeof data === "object" ? data?.nickname : null;
  const isHost = Boolean(typeof data === "object" && data?.isHost);

  if (typeof roomPin !== "string" || !/^\d{6}$/.test(roomPin)) {
    if (callback) callback(JOIN_ERRORS.INVALID_PIN);
    return socket.emit("error", JOIN_ERRORS.INVALID_PIN);
  }

  let service = rooms.get(roomPin);
  if (!service) {
    service = await getRoomService(httpServer, roomPin);
    rooms.set(roomPin, service);
  }

  if (!service || !service.room) {
    if (callback) callback(JOIN_ERRORS.ROOM_NOT_FOUND);
    return socket.emit("error", JOIN_ERRORS.ROOM_NOT_FOUND);
  }

  const quiz = getQuizState(roomPin);
  socket.join(roomPin);

  if (isHost) {
    quiz.hostSocketId = socket.id;
    socket.data = { rid: roomPin, pid: socket.id, isHost: true };
    const playersList = Array.from(quiz.participants.values()).map((p) => ({
      id: p.socketId,
      nickname: p.nickname,
      score: p.score,
    }));
    socket.emit("host-joined", {
      room: {
        pin: roomPin,
        title: service.room.title,
        status: service.room.status,
      },
      state: quiz.questionState,
      currentQuestionIndex: quiz.currentQuestionIndex,
      questions: quiz.questions,
      players: playersList,
    });
    if (callback) callback(null);
    return;
  }

  // Participant join
  const playerNick =
    nickname && nickname.trim().length > 0 ? nickname.trim() : `Player-${socket.id.slice(0, 4)}`;
  const participant = {
    socketId: socket.id,
    nickname: playerNick,
    score: 0,
    hasAnswered: false,
    lastAnswer: null,
    isCorrect: false,
  };

  quiz.participants.set(socket.id, participant);
  socket.data = { rid: roomPin, pid: socket.id, nickname: playerNick, isHost: false };
  service.join(socket.id, playerNick);

  socket.emit("joined", {
    room: {
      pin: service.room.pin,
      title: service.room.title,
      status: service.room.status,
    },
    participant: {
      id: socket.id,
      nickname: playerNick,
    },
    state: quiz.questionState,
  });

  const playersList = Array.from(quiz.participants.values()).map((p) => ({
    id: p.socketId,
    nickname: p.nickname,
    score: p.score,
  }));

  io.to(roomPin).emit("player-list", {
    players: playersList,
    count: playersList.length,
  });

  if (quiz.questionState === "question" && quiz.currentQuestionIndex >= 0) {
    const q = quiz.questions[quiz.currentQuestionIndex];
    if (q) {
      socket.emit("question-started", {
        index: quiz.currentQuestionIndex,
        total: quiz.questions.length,
        id: q.id,
        text: q.text,
        options: q.options,
        timeLimit: q.timeLimit,
        timeRemaining: quiz.timeRemaining,
      });
    }
  }

  if (callback) callback(null);
}

async function handleAnswer(socket, data) {
  const { questionId, answer } = data || {};
  if (!questionId || (typeof questionId !== "number" && typeof questionId !== "string")) {
    return socket.emit("error", "questionId is required");
  }
  if (typeof answer !== "string" || answer.trim().length === 0) {
    return socket.emit("error", "answer is required");
  }

  const { rid, pid } = socket.data || {};
  if (!rid || !pid) return socket.emit("error", "not in a room");

  const quiz = getQuizState(rid);
  if (!quiz) return socket.emit("error", "room not found");

  const rateLimit = rateLimiter.limit(`answer:${rid}:${pid}`);
  if (rateLimit) return socket.emit("error", "too many submissions");

  const participant = quiz.participants.get(pid);
  if (!participant) return socket.emit("error", "participant not found in room");

  if (participant.hasAnswered) {
    return socket.emit("error", "already answered");
  }

  participant.hasAnswered = true;
  participant.lastAnswer = answer.trim();

  socket.emit("answer-ack", { questionId, answer: participant.lastAnswer });

  let answeredCount = 0;
  for (const p of quiz.participants.values()) {
    if (p.hasAnswered) answeredCount += 1;
  }

  io.to(rid).emit("answer-stats", {
    answered: answeredCount,
    total: quiz.participants.size,
  });

  if (answeredCount >= quiz.participants.size && quiz.participants.size > 0) {
    closeQuestion(rid);
  }
}

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("src/index.js") || process.argv[1].endsWith("src/index"));

if (isDirectExecution && process.env.NODE_ENV !== "test" && process.env.VITE_NODE_TEST !== "1") {
  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    log.info(`quiz-platform-backend listening on ${HTTP_HOST}:${HTTP_PORT}`);
  });
}

export {
  app,
  httpServer,
  io,
  rateLimiter,
  handleAnswer,
  onJoinRoom as handleJoin,
  rooms,
  games,
  activeQuizzes,
};
