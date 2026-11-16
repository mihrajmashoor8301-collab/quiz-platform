export const MAX_QUESTIONS = 50;
export const MAX_OPTIONS = 4;
export const MAX_PLAYERS = 200;

export function normalizeText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en");
}

export function validateNickname(value) {
  if (typeof value !== "string") return null;
  const nickname = value.trim().replace(/\s+/g, " ");
  if (nickname.length < 2 || nickname.length > 20 || /[\u0000-\u001f\u007f]/.test(nickname)) return null;
  return nickname;
}

export function normalizeQuestions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_QUESTIONS) {
    throw new Error("A quiz must contain between 1 and 50 questions.");
  }
  return input.map((item, index) => {
    const text = String(item?.question ?? item?.text ?? "").trim();
    const options = Array.isArray(item?.options)
      ? item.options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    const correct = String(item?.correct ?? "").trim();
    const timeLimit = Number(item?.timeLimit ?? 20);
    if (!text || text.length > 500) throw new Error(`Question ${index + 1} needs a prompt under 500 characters.`);
    if (options.length < 2 || options.length > MAX_OPTIONS || options.some((option) => option.length > 200)) {
      throw new Error(`Question ${index + 1} needs 2 to 4 options, each under 200 characters.`);
    }
    if (new Set(options.map(normalizeText)).size !== options.length) {
      throw new Error(`Question ${index + 1} has duplicate options.`);
    }
    if (!options.some((option) => normalizeText(option) === normalizeText(correct))) {
      throw new Error(`Question ${index + 1} must have one correct answer from its options.`);
    }
    if (!Number.isInteger(timeLimit) || timeLimit < 5 || timeLimit > 120) {
      throw new Error(`Question ${index + 1} timer must be from 5 to 120 seconds.`);
    }
    return { id: index + 1, text, options, correct, timeLimit };
  });
}

export function publicQuestion(question, index, total, deadline, now = Date.now()) {
  return {
    index,
    total,
    id: question.id,
    text: question.text,
    options: [...question.options],
    timeLimit: question.timeLimit,
    timeRemaining: Math.max(0, Math.ceil((deadline - now) / 1000)),
    deadline,
  };
}

export function leaderboard(players, includeCorrect = false) {
  return players
    .map((player) => ({
      id: player.id,
      nickname: player.nickname,
      score: player.score,
      ...(includeCorrect ? { isCorrect: Boolean(player.isCorrect) } : {}),
    }))
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
}

export function createRoomState(room, questions, createdAt = Date.now()) {
  if (!room || !/^\d{6}$/.test(String(room.pin)) || !room.hostId) {
    throw new Error("Room identity is invalid.");
  }
  return {
    version: 1,
    pin: String(room.pin),
    quizId: room.quizId,
    hostId: room.hostId,
    title: String(room.title).slice(0, 100),
    maxParticipants: Math.min(MAX_PLAYERS, Math.max(1, Number(room.maxParticipants) || 50)),
    status: "lobby",
    questionState: "lobby",
    questions: normalizeQuestions(questions),
    players: [],
    currentQuestionIndex: -1,
    deadline: null,
    rounds: [],
    lastRoundResults: null,
    finalLeaderboard: null,
    createdAt,
  };
}

export class QuizRoomCore {
  constructor(state, now = () => Date.now()) {
    this.state = state;
    this.now = now;
  }

  isHost(userId) {
    return Boolean(userId && userId === this.state.hostId);
  }

  addPlayer({ id, nickname, sessionHash }) {
    const cleanNickname = validateNickname(nickname);
    if (!cleanNickname) throw new Error("Nickname must be 2 to 20 characters.");
    if (this.state.status === "finished" || this.state.status === "cancelled") throw new Error("This quiz has finished.");
    const existing = this.state.players.find((player) => player.id === id);
    if (existing) {
      existing.nickname = cleanNickname;
      existing.sessionHash = sessionHash || existing.sessionHash;
      return existing;
    }
    if (this.state.players.some((player) => normalizeText(player.nickname) === normalizeText(cleanNickname))) {
      throw new Error("That nickname is already in use in this room.");
    }
    if (this.state.players.length >= this.state.maxParticipants) throw new Error("This room is full.");
    const player = {
      id,
      nickname: cleanNickname,
      sessionHash,
      score: 0,
      hasAnswered: false,
      lastAnswer: null,
      answeredAt: null,
      isCorrect: false,
    };
    this.state.players.push(player);
    return player;
  }

  joinHost(userId) {
    if (!this.isHost(userId)) throw new Error("Host authorization failed.");
    const players = leaderboard(this.state.players);
    const events = [{
      audience: "host",
      event: "host-joined",
      data: {
        room: { pin: this.state.pin, title: this.state.title, status: this.state.status },
        state: this.state.questionState,
        currentQuestionIndex: this.state.currentQuestionIndex,
        questions: this.state.questions,
        players,
      },
    }];
    if (this.state.questionState === "question") {
      events.push({ audience: "host", event: "question-started", data: this.currentQuestionPayload() });
    } else if (this.state.questionState === "results" && this.state.lastRoundResults) {
      events.push({ audience: "host", event: "question-results", data: this.state.lastRoundResults });
    } else if (this.state.questionState === "finished") {
      events.push({ audience: "host", event: "quiz-finished", data: { leaderboard: this.state.finalLeaderboard || players } });
    }
    return events;
  }

  joinPlayer(playerId) {
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player) throw new Error("Player session was not found.");
    const events = [
      {
        audience: `player:${player.id}`,
        event: "joined",
        data: {
          room: { pin: this.state.pin, title: this.state.title, status: this.state.status },
          participant: {
            id: player.id,
            nickname: player.nickname,
            score: player.score,
            hasAnswered: player.hasAnswered,
            lastAnswer: player.lastAnswer,
          },
          state: this.state.questionState,
        },
      },
      { audience: "room", event: "player-list", data: { players: leaderboard(this.state.players), count: this.state.players.length } },
    ];
    if (this.state.questionState === "question") {
      events.push({
        audience: `player:${player.id}`,
        event: "question-started",
        data: { ...this.currentQuestionPayload(), hasAnswered: player.hasAnswered, lastAnswer: player.lastAnswer },
      });
    } else if (this.state.questionState === "results" && this.state.lastRoundResults) {
      events.push({ audience: `player:${player.id}`, event: "question-results", data: this.state.lastRoundResults });
    } else if (this.state.questionState === "finished") {
      events.push({ audience: `player:${player.id}`, event: "quiz-finished", data: { leaderboard: this.state.finalLeaderboard || [] } });
    }
    return events;
  }

  startQuiz(userId) {
    this.requireHost(userId);
    if (this.state.questionState !== "lobby") throw new Error("The quiz has already started.");
    this.state.status = "running";
    return this.startQuestion(0);
  }

  startQuestion(index) {
    const question = this.state.questions[index];
    if (!question) throw new Error("Question not found.");
    this.state.currentQuestionIndex = index;
    this.state.questionState = "question";
    this.state.deadline = this.now() + question.timeLimit * 1000;
    this.state.lastRoundResults = null;
    for (const player of this.state.players) {
      player.hasAnswered = false;
      player.lastAnswer = null;
      player.answeredAt = null;
      player.isCorrect = false;
    }
    return [{ audience: "room", event: "question-started", data: this.currentQuestionPayload() }];
  }

  currentQuestionPayload() {
    const question = this.state.questions[this.state.currentQuestionIndex];
    if (!question || !this.state.deadline) return null;
    return publicQuestion(question, this.state.currentQuestionIndex, this.state.questions.length, this.state.deadline, this.now());
  }

  addQuestion(userId, input) {
    this.requireHost(userId);
    if (this.state.questionState !== "lobby") throw new Error("Questions cannot be changed after the quiz starts.");
    if (this.state.questions.length >= MAX_QUESTIONS) throw new Error("A quiz can have at most 50 questions.");
    const [question] = normalizeQuestions([input]);
    question.id = this.state.questions.length + 1;
    this.state.questions.push(question);
    return question;
  }

  submitAnswer(playerId, { questionId, answer } = {}) {
    const player = this.state.players.find((item) => item.id === playerId);
    const question = this.state.questions[this.state.currentQuestionIndex];
    if (!player) throw new Error("Player session was not found.");
    if (this.state.questionState !== "question" || !question || this.now() >= this.state.deadline) {
      throw new Error("This question is closed.");
    }
    if (String(questionId) !== String(question.id)) throw new Error("Question id does not match the active question.");
    if (player.hasAnswered) throw new Error("You already answered this question.");
    if (typeof answer !== "string" || answer.trim().length < 1 || answer.trim().length > 200) {
      throw new Error("Answer must be 1 to 200 characters.");
    }
    const cleanAnswer = question.options.find((option) => normalizeText(option) === normalizeText(answer));
    if (!cleanAnswer) throw new Error("Answer is not one of the available options.");
    player.hasAnswered = true;
    player.lastAnswer = cleanAnswer;
    player.answeredAt = this.now();
    const answered = this.state.players.filter((item) => item.hasAnswered).length;
    const events = [
      { audience: `player:${player.id}`, event: "answer-ack", data: { questionId, answer: cleanAnswer } },
      { audience: "host", event: "answer-stats", data: { answered, total: this.state.players.length } },
    ];
    if (answered === this.state.players.length && answered > 0) events.push(...this.closeQuestion());
    return events;
  }

  closeQuestion() {
    if (this.state.questionState !== "question") return [];
    const question = this.state.questions[this.state.currentQuestionIndex];
    if (!question) return [];
    const normCorrect = normalizeText(question.correct);
    const optionCounts = Object.fromEntries(question.options.map((option) => [option, 0]));
    for (const player of this.state.players) {
      player.isCorrect = Boolean(player.lastAnswer && normalizeText(player.lastAnswer) === normCorrect);
      if (player.lastAnswer) optionCounts[player.lastAnswer] = (optionCounts[player.lastAnswer] || 0) + 1;
      if (player.isCorrect) {
        const secondsRemaining = Math.max(0, Math.ceil((this.state.deadline - player.answeredAt) / 1000));
        player.score += 1000 + secondsRemaining * 15;
      }
    }
    this.state.questionState = "results";
    const results = {
      questionId: question.id,
      correctAnswers: [question.correct],
      optionCounts,
      leaderboard: leaderboard(this.state.players, true),
      hasNext: this.state.currentQuestionIndex < this.state.questions.length - 1,
    };
    this.state.lastRoundResults = results;
    this.state.rounds.push({
      questionIndex: this.state.currentQuestionIndex,
      question: question.text,
      correctAnswer: question.correct,
      optionCounts,
      answers: this.state.players.filter((player) => player.lastAnswer).map((player) => ({
        participantId: player.id,
        answer: player.lastAnswer,
        isCorrect: player.isCorrect,
        scoreAwarded: player.isCorrect ? 1000 + Math.max(0, Math.ceil((this.state.deadline - player.answeredAt) / 1000)) * 15 : 0,
        submittedAt: player.answeredAt,
      })),
    });
    return [{ audience: "room", event: "question-results", data: results }];
  }

  closeEarly(userId) {
    this.requireHost(userId);
    return this.closeQuestion();
  }

  nextQuestion(userId) {
    this.requireHost(userId);
    if (this.state.questionState !== "results") throw new Error("The current question is not complete.");
    const nextIndex = this.state.currentQuestionIndex + 1;
    if (nextIndex < this.state.questions.length) return this.startQuestion(nextIndex);
    return this.finishQuiz(userId);
  }

  finishQuiz(userId) {
    this.requireHost(userId);
    return this.finish();
  }

  finish() {
    if (this.state.questionState === "finished") return [];
    const events = this.state.questionState === "question" ? this.closeQuestion() : [];
    this.state.status = "finished";
    this.state.questionState = "finished";
    this.state.deadline = null;
    this.state.finalLeaderboard = leaderboard(this.state.players);
    events.push({ audience: "room", event: "quiz-finished", data: { leaderboard: this.state.finalLeaderboard } });
    return events;
  }

  onAlarm(now = this.now()) {
    if (this.state.questionState !== "question" || !this.state.deadline || now < this.state.deadline) return [];
    return this.closeQuestion();
  }

  requireHost(userId) {
    if (!this.isHost(userId)) throw new Error("Host authorization failed.");
  }
}
