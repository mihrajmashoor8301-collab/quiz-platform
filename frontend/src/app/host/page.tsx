"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  Plus,
  Play,
  Sparkles,
  Trophy,
  Users,
  Clock,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Crown,
} from "lucide-react";

interface QuestionItem {
  id?: number;
  question: string;
  options: string[];
  correct: string;
  timeLimit: number;
}

interface Player {
  id: string;
  nickname: string;
  score: number;
  isCorrect?: boolean;
}

export default function HostPage() {
  const [title, setTitle] = useState("Live Trivia Showdown");
  const [maxParticipants, setMaxParticipants] = useState(200);
  const [room, setRoom] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [questions, setQuestions] = useState<QuestionItem[]>([
    {
      question: "What is the capital of France?",
      options: ["London", "Paris", "Berlin", "Madrid"],
      correct: "Paris",
      timeLimit: 20,
    },
    {
      question: "Which planet is known as the Red Planet?",
      options: ["Venus", "Mars", "Jupiter", "Saturn"],
      correct: "Mars",
      timeLimit: 20,
    },
    {
      question: "What is 12 × 12?",
      options: ["124", "144", "164", "142"],
      correct: "144",
      timeLimit: 15,
    },
  ]);

  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState(["", "", "", ""]);
  const [newCorrect, setNewCorrect] = useState("");
  const [newTimeLimit, setNewTimeLimit] = useState(20);

  // Live Game State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<"setup" | "lobby" | "question" | "results" | "finished">("setup");
  const [players, setPlayers] = useState<Player[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [answerStats, setAnswerStats] = useState({ answered: 0, total: 0 });
  const [roundResults, setRoundResults] = useState<any>(null);
  const [finalLeaderboard, setFinalLeaderboard] = useState<Player[]>([]);

  const getBackendUrl = () => {
    if (typeof window !== "undefined") return window.location.origin;
    return process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const backendUrl = getBackendUrl();
      const res = await fetch(`${backendUrl}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, maxParticipants }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create room.");
      }

      const created = await res.json();
      setRoom(created);

      // Upload questions to backend
      for (const q of questions) {
        await fetch(`${backendUrl}/rooms/${created.pin}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q.question,
            options: q.options,
            timeLimit: q.timeLimit,
            correct: [q.correct],
          }),
        });
      }

      // Connect socket as Host
      const s = io(backendUrl, { transports: ["websocket", "polling"] });

      s.on("connect", () => {
        s.emit("join-room", { roomPin: created.pin, isHost: true });
        setGameState("lobby");
      });

      s.on("player-list", (data: { players: Player[] }) => {
        setPlayers(data.players || []);
      });

      s.on("question-started", (data) => {
        setActiveQuestion(data);
        setTimeRemaining(data.timeRemaining);
        setAnswerStats({ answered: 0, total: players.length });
        setRoundResults(null);
        setGameState("question");
      });

      s.on("timer-tick", (data: { timeRemaining: number }) => {
        setTimeRemaining(data.timeRemaining);
      });

      s.on("answer-stats", (data: { answered: number; total: number }) => {
        setAnswerStats(data);
      });

      s.on("question-results", (data) => {
        setRoundResults(data);
        setPlayers(data.leaderboard || []);
        setGameState("results");
      });

      s.on("quiz-finished", (data: { leaderboard: Player[] }) => {
        setFinalLeaderboard(data.leaderboard || []);
        setGameState("finished");
      });

      setSocket(s);
    } catch (err: any) {
      setError(err.message || "Failed to launch quiz room.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartQuiz = () => {
    if (!socket) return;
    socket.emit("start-quiz");
  };

  const handleNextQuestion = () => {
    if (!socket) return;
    socket.emit("next-question");
  };

  const handleCloseQuestion = () => {
    if (!socket) return;
    socket.emit("close-question");
  };

  const handleAddQuestion = () => {
    if (!newQuestion.trim()) return;
    const filteredOptions = newOptions.filter((o) => o.trim().length > 0);
    if (filteredOptions.length < 2) {
      setError("Please provide at least 2 options for the question.");
      return;
    }
    const correct = newCorrect.trim() || filteredOptions[0];

    setQuestions((prev) => [
      ...prev,
      {
        question: newQuestion.trim(),
        options: filteredOptions,
        correct,
        timeLimit: newTimeLimit,
      },
    ]);

    setNewQuestion("");
    setNewOptions(["", "", "", ""]);
    setNewCorrect("");
    setError("");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Setup View */}
      {gameState === "setup" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 flex items-center gap-2">
              <span>Host a Live Quiz</span>
              <Sparkles className="w-6 h-6 text-indigo-500" />
            </h1>
            <p className="text-slate-500 mt-1">
              Configure your quiz, launch a 6-digit room PIN, and control the presentation live.
            </p>
          </div>

          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleCreateRoom} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-xl font-bold text-slate-800">1. Room Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  Quiz Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  Capacity
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-xl flex items-center gap-2 transition disabled:opacity-50"
              >
                <Play className="w-5 h-5" />
                <span>{loading ? "Creating..." : "Launch Game PIN & Lobby"}</span>
              </button>
            </div>
          </form>

          {/* Question List */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-xl font-bold text-slate-800">
              2. Questions ({questions.length})
            </h2>

            <div className="space-y-3">
              {questions.map((q, idx) => (
                <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-start justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                      Q{idx + 1}
                    </span>
                    <p className="font-semibold text-slate-800 mt-1">{q.question}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {q.options.map((opt, oIdx) => (
                        <span
                          key={oIdx}
                          className={`text-xs px-2.5 py-1 rounded-full border ${
                            opt === q.correct
                              ? "bg-emerald-50 border-emerald-300 text-emerald-700 font-semibold"
                              : "bg-white border-slate-200 text-slate-600"
                          }`}
                        >
                          {opt} {opt === q.correct && "✓"}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">{q.timeLimit}s</span>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Add Question</h3>
              <input
                type="text"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="Question prompt..."
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                {newOptions.map((opt, i) => (
                  <input
                    key={i}
                    type="text"
                    value={opt}
                    onChange={(e) => {
                      const updated = [...newOptions];
                      updated[i] = e.target.value;
                      setNewOptions(updated);
                    }}
                    placeholder={`Option ${i + 1}`}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                  />
                ))}
              </div>
              <div className="flex gap-4">
                <input
                  type="text"
                  value={newCorrect}
                  onChange={(e) => setNewCorrect(e.target.value)}
                  placeholder="Correct answer (exact text)"
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                />
                <input
                  type="number"
                  value={newTimeLimit}
                  onChange={(e) => setNewTimeLimit(Number(e.target.value))}
                  placeholder="Seconds"
                  className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                />
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lobby View (Waiting for Players) */}
      {gameState === "lobby" && room && (
        <div className="bg-white p-8 rounded-3xl shadow-md border border-slate-200 text-center space-y-8">
          <div>
            <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider">
              Join at <span className="text-indigo-600 font-bold">{typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}</span> with PIN
            </p>
            <div className="text-7xl font-black font-mono tracking-widest text-indigo-600 mt-2 select-all">
              {room.pin}
            </div>
          </div>

          <div className="py-6 border-y border-slate-100">
            <div className="flex items-center justify-center gap-2 text-slate-700 font-semibold mb-4">
              <Users className="w-5 h-5 text-indigo-600" />
              <span>Joined Players ({players.length})</span>
            </div>

            {players.length === 0 ? (
              <div className="py-8 text-slate-400 animate-pulse text-sm">
                Waiting for players to join...
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
                {players.map((p, i) => (
                  <span
                    key={i}
                    className="bg-indigo-50 border border-indigo-200 text-indigo-800 font-medium px-4 py-2 rounded-xl text-sm animate-fade-in"
                  >
                    {p.nickname}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleStartQuiz}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 px-10 rounded-2xl text-lg flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
            >
              <Play className="w-6 h-6" />
              <span>Start Quiz ({questions.length} Questions)</span>
            </button>
          </div>
        </div>
      )}

      {/* Active Question View */}
      {gameState === "question" && activeQuestion && (
        <div className="bg-white p-8 rounded-3xl shadow-md border border-slate-200 space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-md">
              Question {activeQuestion.index + 1} of {activeQuestion.total}
            </span>
            <div className="flex items-center gap-2 text-rose-600 font-mono font-bold text-lg bg-rose-50 px-3 py-1 rounded-md">
              <Clock className="w-5 h-5" />
              <span>{timeRemaining}s</span>
            </div>
          </div>

          <h2 className="text-3xl font-extrabold text-slate-900 leading-snug">
            {activeQuestion.text}
          </h2>

          <div className="grid grid-cols-2 gap-4 pt-2">
            {activeQuestion.options.map((opt: string, i: number) => {
              const bgColors = [
                "bg-red-500 text-white",
                "bg-blue-500 text-white",
                "bg-amber-500 text-white",
                "bg-emerald-500 text-white",
              ];
              const shapes = ["▲", "◆", "●", "■"];
              return (
                <div
                  key={i}
                  className={`p-6 rounded-2xl font-bold text-xl flex items-center gap-4 ${bgColors[i % 4]} shadow-sm`}
                >
                  <span className="text-2xl opacity-75">{shapes[i % 4]}</span>
                  <span>{opt}</span>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-600">
              Answers received:{" "}
              <span className="text-indigo-600 font-bold">
                {answerStats.answered}
              </span>{" "}
              / {players.length}
            </div>

            <button
              onClick={handleCloseQuestion}
              className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-2 px-5 rounded-lg text-sm"
            >
              End Question Early
            </button>
          </div>
        </div>
      )}

      {/* Round Results View */}
      {gameState === "results" && roundResults && (
        <div className="bg-white p-8 rounded-3xl shadow-md border border-slate-200 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              <span>Correct Answer: {roundResults.correctAnswers?.join(", ")}</span>
            </h2>
            <button
              onClick={handleNextQuestion}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl flex items-center gap-2 transition"
            >
              <span>{roundResults.hasNext ? "Next Question" : "See Final Podium"}</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          {/* Option Distribution */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <h3 className="text-xs uppercase font-semibold text-slate-500 mb-3">Answers Distribution</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(roundResults.optionCounts || {}).map(([opt, count], i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200">
                  <span className="font-semibold text-sm text-slate-800">{opt}</span>
                  <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-xs">
                    {String(count)} votes
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Current Leaderboard */}
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span>Leaderboard</span>
            </h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
              {players.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-white">
                  <div className="flex items-center gap-3">
                    <span className="w-6 font-bold text-slate-400 text-center">#{i + 1}</span>
                    <span className="font-semibold text-slate-800">{p.nickname}</span>
                    {p.isCorrect && (
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                        +Points
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold text-slate-900">{p.score} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Finished Podium View */}
      {gameState === "finished" && (
        <div className="bg-white p-12 rounded-3xl shadow-lg border border-slate-200 text-center space-y-8">
          <div className="inline-flex p-4 bg-amber-100 rounded-full text-amber-600 mb-2">
            <Crown className="w-12 h-12" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900">Quiz Completed!</h1>
            <p className="text-slate-500 mt-2">Here is the final champion podium:</p>
          </div>

          <div className="max-w-md mx-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {finalLeaderboard.map((p, idx) => {
              const medals = ["🥇", "🥈", "🥉"];
              return (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-4 ${
                    idx === 0 ? "bg-amber-50 font-bold" : "bg-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{medals[idx] || `#${idx + 1}`}</span>
                    <span className="text-slate-800">{p.nickname}</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-600">{p.score} pts</span>
                </div>
              );
            })}
          </div>

          <div className="pt-4">
            <button
              onClick={() => {
                setRoom(null);
                setGameState("setup");
                if (socket) socket.disconnect();
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl"
            >
              Host Another Quiz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
