"use client";

import { useState, useEffect } from "react";
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
  Trash2,
  Edit3,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
  RotateCcw,
  Wifi,
  QrCode,
} from "lucide-react";

export interface QuestionItem {
  id?: number;
  question: string;
  options: string[];
  correct: string;
  timeLimit: number;
}

export interface Player {
  id: string;
  nickname: string;
  score: number;
  isCorrect?: boolean;
}

const OPTION_THEMES = [
  { bg: "bg-red-500", text: "text-red-600", light: "bg-red-50", border: "border-red-200", shape: "▲", label: "A" },
  { bg: "bg-blue-500", text: "text-blue-600", light: "bg-blue-50", border: "border-blue-200", shape: "◆", label: "B" },
  { bg: "bg-amber-500", text: "text-amber-600", light: "bg-amber-50", border: "border-amber-200", shape: "●", label: "C" },
  { bg: "bg-emerald-500", text: "text-emerald-600", light: "bg-emerald-50", border: "border-emerald-200", shape: "■", label: "D" },
];

const TIME_PRESETS = [10, 15, 20, 30, 45, 60];

const SAMPLE_PRESETS: QuestionItem[] = [
  {
    question: "What is the capital of Japan?",
    options: ["Kyoto", "Tokyo", "Osaka", "Hiroshima"],
    correct: "Tokyo",
    timeLimit: 20,
  },
  {
    question: "Which element has the chemical symbol 'Au'?",
    options: ["Silver", "Gold", "Copper", "Platinum"],
    correct: "Gold",
    timeLimit: 20,
  },
  {
    question: "How many planets are in our Solar System?",
    options: ["7", "8", "9", "10"],
    correct: "8",
    timeLimit: 15,
  },
];

export default function HostPage() {
  const [title, setTitle] = useState("My Live Quiz");
  const [maxParticipants, setMaxParticipants] = useState(50);
  const [room, setRoom] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<{ primaryIp?: string; wifiUrl?: string } | null>(null);

  // Global Time Setting
  const [globalTimeLimit, setGlobalTimeLimit] = useState(20);

  // Configured Questions List (Empty by default - no hardcoded test questions)
  const [questions, setQuestions] = useState<QuestionItem[]>([]);

  // Question Form State (for adding / editing)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [correctOptionIndex, setCorrectOptionIndex] = useState<number>(0);
  const [questionTimeLimit, setQuestionTimeLimit] = useState(20);

  // Live Game States: "setup" | "lobby" | "question" | "results" | "finished"
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

  useEffect(() => {
    fetch(`${getBackendUrl()}/network-info`)
      .then((res) => res.json())
      .then((data) => setNetworkInfo(data))
      .catch(() => {});
  }, []);

  // Apply a time limit to all questions at once
  const handleApplyTimeToAll = (seconds: number) => {
    setGlobalTimeLimit(seconds);
    setQuestionTimeLimit(seconds);
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        timeLimit: seconds,
      }))
    );
  };

  // Save or Add Question
  const handleSaveQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!prompt.trim()) {
      setError("Please enter a question prompt.");
      return;
    }

    const trimmedOptions = options.map((opt) => opt.trim());
    const validOptions = trimmedOptions.filter((opt) => opt.length > 0);

    if (validOptions.length < 2) {
      setError("Please provide at least 2 options.");
      return;
    }

    const selectedCorrectText = trimmedOptions[correctOptionIndex];
    if (!selectedCorrectText || selectedCorrectText.length === 0) {
      setError(`Option ${correctOptionIndex + 1} (${OPTION_THEMES[correctOptionIndex].label}) is marked as correct, but it cannot be blank.`);
      return;
    }

    const finalQuestion: QuestionItem = {
      question: prompt.trim(),
      options: trimmedOptions.filter((o) => o.length > 0),
      correct: selectedCorrectText,
      timeLimit: Math.max(5, Number(questionTimeLimit) || globalTimeLimit),
    };

    if (editingIndex !== null) {
      // Update existing question
      setQuestions((prev) => {
        const next = [...prev];
        next[editingIndex] = finalQuestion;
        return next;
      });
      setEditingIndex(null);
    } else {
      // Add new question
      setQuestions((prev) => [...prev, finalQuestion]);
    }

    // Reset Form
    setPrompt("");
    setOptions(["", "", "", ""]);
    setCorrectOptionIndex(0);
    setQuestionTimeLimit(globalTimeLimit);
  };

  const handleEditQuestion = (idx: number) => {
    const q = questions[idx];
    setEditingIndex(idx);
    setPrompt(q.question);

    const paddedOptions = [...q.options];
    while (paddedOptions.length < 4) paddedOptions.push("");
    setOptions(paddedOptions);

    const cIndex = paddedOptions.findIndex((opt) => opt === q.correct);
    setCorrectOptionIndex(cIndex !== -1 ? cIndex : 0);
    setQuestionTimeLimit(q.timeLimit || globalTimeLimit);
    setError("");
  };

  const handleDeleteQuestion = (idx: number) => {
    if (editingIndex === idx) {
      setEditingIndex(null);
      setPrompt("");
      setOptions(["", "", "", ""]);
      setCorrectOptionIndex(0);
    }
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMoveQuestion = (idx: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= questions.length) return;

    setQuestions((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  };

  const handleLoadSampleQuiz = () => {
    setQuestions(SAMPLE_PRESETS);
    setError("");
  };

  const handleClearAllQuestions = () => {
    if (confirm("Are you sure you want to clear all questions?")) {
      setQuestions([]);
      setEditingIndex(null);
      setPrompt("");
      setOptions(["", "", "", ""]);
    }
  };

  // Launch Game PIN and Room Lobby
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (questions.length === 0) {
      setError("Please add at least 1 question before launching the game lobby.");
      return;
    }

    setLoading(true);

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

      // Upload configured questions to room
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

      // Connect Socket.IO as Host
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

  const handleCopyPin = () => {
    if (!room?.pin) return;
    navigator.clipboard.writeText(room.pin);
    setCopiedPin(true);
    setTimeout(() => setCopiedPin(false), 2000);
  };

  const handleCopyLink = () => {
    if (!room?.pin) return;
    const baseUrl = networkInfo?.wifiUrl || getBackendUrl();
    const url = `${baseUrl}/?pin=${room.pin}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* ----------------- SETUP VIEW ----------------- */}
      {gameState === "setup" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-800 flex items-center gap-2">
                <span>Quiz Creator & Host</span>
                <Sparkles className="w-6 h-6 text-indigo-500" />
              </h1>
              <p className="text-slate-500 mt-1">
                Configure custom questions, pick correct answers, adjust timers, and launch your live lobby.
              </p>
              {networkInfo?.wifiUrl && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold mt-2">
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Wi-Fi Network: <strong className="font-mono text-emerald-800">{networkInfo.wifiUrl}</strong></span>
                </div>
              )}
            </div>
            {questions.length === 0 && (
              <button
                type="button"
                onClick={handleLoadSampleQuiz}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition border border-indigo-200 self-start"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Sample Trivia (3 Questions)</span>
              </button>
            )}
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm flex items-center gap-2">
              <XCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Room Settings Card */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">1. Room Details & Global Time Setting</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  Quiz Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Science Bowl, Friday Team Trivia..."
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  Player Capacity
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

            {/* Global Timer Configuration */}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl">
              <div>
                <span className="text-xs font-bold uppercase text-slate-700 block">Default Time Limit for All Questions</span>
                <span className="text-xs text-slate-500">Pick a preset or enter custom seconds</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {TIME_PRESETS.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    onClick={() => handleApplyTimeToAll(seconds)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      globalTimeLimit === seconds
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-white text-slate-700 border border-slate-200 hover:border-indigo-300"
                    }`}
                  >
                    {seconds}s
                  </button>
                ))}
                <div className="flex items-center gap-1.5 ml-2">
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={globalTimeLimit}
                    onChange={(e) => setGlobalTimeLimit(Math.max(5, Number(e.target.value)))}
                    className="w-16 px-2 py-1 text-xs border border-slate-300 rounded-lg text-center font-bold"
                  />
                  <span className="text-xs text-slate-500 font-medium">sec</span>
                  <button
                    type="button"
                    onClick={() => handleApplyTimeToAll(globalTimeLimit)}
                    className="ml-1 px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition"
                  >
                    Apply to All
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Question Builder Card */}
          <form
            onSubmit={handleSaveQuestion}
            className={`p-6 rounded-2xl shadow-sm border space-y-5 transition ${
              editingIndex !== null
                ? "bg-indigo-50/50 border-indigo-300 ring-2 ring-indigo-500/20"
                : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>{editingIndex !== null ? `Edit Question #${editingIndex + 1}` : "2. Create a Question"}</span>
                {editingIndex !== null && (
                  <span className="text-xs font-bold bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                    Editing Mode
                  </span>
                )}
              </h2>

              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500" />
                <label className="text-xs font-semibold text-slate-600">Question Timer:</label>
                <select
                  value={questionTimeLimit}
                  onChange={(e) => setQuestionTimeLimit(Number(e.target.value))}
                  className="px-2.5 py-1 text-xs font-bold border border-slate-300 rounded-lg bg-white"
                >
                  {TIME_PRESETS.map((t) => (
                    <option key={t} value={t}>
                      {t} seconds
                    </option>
                  ))}
                  {!TIME_PRESETS.includes(questionTimeLimit) && (
                    <option value={questionTimeLimit}>{questionTimeLimit} seconds</option>
                  )}
                </select>
              </div>
            </div>

            {/* Question Prompt */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Question Prompt
              </label>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Which planet is closest to the sun?"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-base font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            {/* Selectable Options Grid */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase text-slate-600">
                  Options & Selectable Correct Answer
                </label>
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Click checkmark or radio to mark the correct answer
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {options.map((opt, i) => {
                  const theme = OPTION_THEMES[i];
                  const isCorrect = correctOptionIndex === i;

                  return (
                    <div
                      key={i}
                      className={`relative flex items-center p-3 rounded-xl border-2 transition ${
                        isCorrect
                          ? "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      {/* Shape Pill */}
                      <span
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-xs mr-3 flex-shrink-0 ${theme.bg}`}
                      >
                        {theme.shape}
                      </span>

                      {/* Option Text Input */}
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const updated = [...options];
                          updated[i] = e.target.value;
                          setOptions(updated);
                        }}
                        placeholder={`Option ${theme.label} ${i < 2 ? "(required)" : "(optional)"}`}
                        className="flex-1 bg-transparent border-0 text-sm font-medium text-slate-900 focus:outline-none placeholder:text-slate-400 mr-2"
                        required={i < 2}
                      />

                      {/* Selectable Correct Toggle Button */}
                      <button
                        type="button"
                        onClick={() => setCorrectOptionIndex(i)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                          isCorrect
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                        }`}
                        title="Click to mark this option as correct"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isCorrect ? "Correct ✓" : "Mark Correct"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Form Actions */}
            <div className="pt-2 flex items-center justify-end gap-3">
              {editingIndex !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingIndex(null);
                    setPrompt("");
                    setOptions(["", "", "", ""]);
                    setCorrectOptionIndex(0);
                  }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition"
                >
                  Cancel Edit
                </button>
              )}

              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl text-sm flex items-center gap-2 shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                <span>{editingIndex !== null ? "Save Changes" : "Add Question to Quiz"}</span>
              </button>
            </div>
          </form>

          {/* Configured Questions List Preview */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  3. Configured Questions ({questions.length})
                </h2>
                <p className="text-xs text-slate-500">
                  {questions.length > 0
                    ? `Total estimated game duration: ~${questions.reduce((a, b) => a + (b.timeLimit || 20), 0)}s`
                    : "Add questions above to build your quiz."}
                </p>
              </div>

              {questions.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllQuestions}
                  className="text-xs text-slate-400 hover:text-red-600 font-semibold flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
              )}
            </div>

            {questions.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl space-y-3">
                <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-semibold text-slate-700">No questions added yet</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Use the form above to add custom questions, or click below to load a sample quiz.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLoadSampleQuiz}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load Sample Trivia</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {questions.map((q, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md">
                          Q{idx + 1}
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-500 flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-slate-200">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {q.timeLimit}s
                        </span>
                        <span className="text-sm font-bold text-slate-900 ml-1">{q.question}</span>
                      </div>

                      {/* Options Preview */}
                      <div className="flex flex-wrap gap-1.5">
                        {q.options.map((opt, oIdx) => {
                          const isCorrect = opt === q.correct;
                          return (
                            <span
                              key={oIdx}
                              className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 font-medium ${
                                isCorrect
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-bold shadow-xs"
                                  : "bg-white border-slate-200 text-slate-600"
                              }`}
                            >
                              <span>{OPTION_THEMES[oIdx]?.shape}</span>
                              <span>{opt}</span>
                              {isCorrect && <Check className="w-3 h-3 text-emerald-600 font-bold" />}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Question Actions */}
                    <div className="flex items-center gap-1 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => handleMoveQuestion(idx, "up")}
                        disabled={idx === 0}
                        className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition"
                        title="Move Up"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveQuestion(idx, "down")}
                        disabled={idx === questions.length - 1}
                        className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition"
                        title="Move Down"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditQuestion(idx)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition"
                        title="Edit Question"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuestion(idx)}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-md transition"
                        title="Delete Question"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Launch Game Lobby Button */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {questions.length > 0
                  ? `Ready to launch with ${questions.length} question${questions.length > 1 ? "s" : ""}.`
                  : "Add at least 1 question to launch game."}
              </span>

              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={loading || questions.length === 0}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl flex items-center gap-2 shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed text-base"
              >
                <Play className="w-5 h-5" />
                <span>{loading ? "Generating PIN..." : "Launch Game PIN & Lobby"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- LOBBY VIEW ----------------- */}
      {gameState === "lobby" && room && (
        <div className="bg-white p-8 sm:p-12 rounded-3xl shadow-md border border-slate-200 text-center space-y-8 animate-fade-in">
          <div>
            <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-widest px-3.5 py-1.5 rounded-full border border-indigo-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span>Lobby Active</span>
            </div>

            {/* Local Wi-Fi Address Banner */}
            <div className="max-w-lg mx-auto mt-4 p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-indigo-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left shadow-xs">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-xs">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 block">
                    Join on your phone or laptop (Wi-Fi):
                  </span>
                  <span className="font-mono font-black text-lg text-slate-800 select-all">
                    {networkInfo?.wifiUrl || getBackendUrl()}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQr(!showQr)}
                className="px-3.5 py-2 bg-white border border-indigo-200 hover:bg-indigo-100 rounded-xl text-xs font-bold text-indigo-700 flex items-center gap-1.5 transition shadow-xs flex-shrink-0"
              >
                <QrCode className="w-4 h-4" />
                <span>{showQr ? "Hide QR" : "Show QR Code"}</span>
              </button>
            </div>

            {/* QR Code Popup */}
            {showQr && (
              <div className="mt-4 p-5 bg-white border-2 border-indigo-200 rounded-2xl shadow-md inline-block animate-fade-in">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    `${networkInfo?.wifiUrl || getBackendUrl()}/?pin=${room.pin}`
                  )}`}
                  alt="Scan QR code to join"
                  className="w-44 h-44 mx-auto rounded-xl p-1 bg-white border border-slate-200"
                />
                <p className="text-xs font-bold text-indigo-700 mt-2.5">
                  Point your phone's camera to join instantly!
                </p>
              </div>
            )}

            <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mt-5">
              Enter 6-Digit Game PIN:
            </p>
            <div className="text-7xl sm:text-8xl font-black font-mono tracking-widest text-indigo-600 mt-1 select-all drop-shadow-sm">
              {room.pin}
            </div>

            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={handleCopyPin}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition shadow-xs"
              >
                {copiedPin ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedPin ? "PIN Copied!" : "Copy PIN"}</span>
              </button>
              <button
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition shadow-xs"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? "Link Copied!" : "Copy Wi-Fi Join Link"}</span>
              </button>
            </div>
          </div>

          <div className="py-6 border-y border-slate-100">
            <div className="flex items-center justify-center gap-2 text-slate-700 font-semibold mb-4">
              <Users className="w-5 h-5 text-indigo-600" />
              <span>Joined Players ({players.length})</span>
            </div>

            {players.length === 0 ? (
              <div className="py-8 text-slate-400 animate-pulse text-sm">
                Waiting for players to enter PIN and join...
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
                {players.map((p, i) => (
                  <span
                    key={i}
                    className="bg-indigo-50 border border-indigo-200 text-indigo-800 font-bold px-4 py-2 rounded-xl text-sm shadow-xs animate-fade-in"
                  >
                    {p.nickname}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => {
                if (confirm("Cancel this room and return to editor?")) {
                  if (socket) socket.disconnect();
                  setGameState("setup");
                }
              }}
              className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-sm transition"
            >
              Back to Editor
            </button>

            <button
              onClick={handleStartQuiz}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-4 px-12 rounded-2xl text-lg flex items-center gap-3 shadow-lg shadow-emerald-600/25 transition"
            >
              <Play className="w-6 h-6" />
              <span>Start Quiz ({questions.length} Questions)</span>
            </button>
          </div>
        </div>
      )}

      {/* ----------------- QUESTION VIEW ----------------- */}
      {gameState === "question" && activeQuestion && (
        <div className="bg-white p-8 rounded-3xl shadow-md border border-slate-200 space-y-6 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-md">
              Question {activeQuestion.index + 1} of {activeQuestion.total}
            </span>
            <div className="flex items-center gap-2 text-rose-600 font-mono font-bold text-xl bg-rose-50 px-3.5 py-1.5 rounded-lg border border-rose-200 animate-pulse">
              <Clock className="w-5 h-5" />
              <span>{timeRemaining}s</span>
            </div>
          </div>

          {/* Time Progress Bar */}
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-rose-500 h-2.5 rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${Math.max(0, Math.min(100, (timeRemaining / (activeQuestion.timeLimit || 20)) * 100))}%`,
              }}
            />
          </div>

          <h2 className="text-3xl font-extrabold text-slate-900 leading-snug">
            {activeQuestion.text}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {activeQuestion.options.map((opt: string, i: number) => {
              const theme = OPTION_THEMES[i % 4];
              return (
                <div
                  key={i}
                  className={`p-6 rounded-2xl font-bold text-xl flex items-center gap-4 ${theme.bg} text-white shadow-sm`}
                >
                  <span className="text-2xl opacity-75">{theme.shape}</span>
                  <span>{opt}</span>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-600">
              Answers received:{" "}
              <span className="text-indigo-600 font-bold text-base">
                {answerStats.answered}
              </span>{" "}
              / {players.length}
            </div>

            <button
              onClick={handleCloseQuestion}
              className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-2 px-5 rounded-lg text-sm transition"
            >
              End Question Early
            </button>
          </div>
        </div>
      )}

      {/* ----------------- RESULTS VIEW ----------------- */}
      {gameState === "results" && roundResults && (
        <div className="bg-white p-8 rounded-3xl shadow-md border border-slate-200 space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              <span>Correct Answer: {roundResults.correctAnswers?.join(", ")}</span>
            </h2>
            <button
              onClick={handleNextQuestion}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl flex items-center gap-2 transition shadow-sm self-start sm:self-auto"
            >
              <span>{roundResults.hasNext ? "Next Question" : "See Final Podium"}</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          {/* Option Distribution */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200">
            <h3 className="text-xs uppercase font-semibold text-slate-500 mb-3">Player Answer Distribution</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(roundResults.optionCounts || {}).map(([opt, count], i) => {
                const isCorrect = roundResults.correctAnswers?.includes(opt);
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-3.5 rounded-xl border ${
                      isCorrect
                        ? "bg-emerald-50 border-emerald-300 font-bold"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400">#{i + 1}</span>
                      <span className="text-sm text-slate-800">{opt}</span>
                      {isCorrect && <Check className="w-4 h-4 text-emerald-600" />}
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-md ${
                        isCorrect ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {String(count)} vote{count === 1 ? "" : "s"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Current Leaderboard */}
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span>Current Leaderboard</span>
            </h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              {players.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-white">
                  <div className="flex items-center gap-3">
                    <span className="w-6 font-bold text-slate-400 text-center">#{i + 1}</span>
                    <span className="font-semibold text-slate-800">{p.nickname}</span>
                    {p.isCorrect && (
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
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

      {/* ----------------- FINISHED PODIUM VIEW ----------------- */}
      {gameState === "finished" && (
        <div className="bg-white p-8 sm:p-12 rounded-3xl shadow-lg border border-slate-200 text-center space-y-8 animate-fade-in">
          <div className="inline-flex p-5 bg-amber-100 rounded-full text-amber-600 mb-2 shadow-inner">
            <Crown className="w-14 h-14" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900">Quiz Completed!</h1>
            <p className="text-slate-500 mt-2">Here is the final champion podium:</p>
          </div>

          <div className="max-w-md mx-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {finalLeaderboard.length === 0 ? (
              <div className="p-6 text-slate-400 text-sm">No players finished the quiz.</div>
            ) : (
              finalLeaderboard.map((p, idx) => {
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-4 ${
                      idx === 0 ? "bg-amber-50/70 font-bold" : "bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{medals[idx] || `#${idx + 1}`}</span>
                      <span className="text-slate-800 font-semibold">{p.nickname}</span>
                    </div>
                    <span className="font-mono font-bold text-indigo-600 text-lg">{p.score} pts</span>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => {
                setRoom(null);
                setGameState("setup");
                if (socket) socket.disconnect();
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 px-8 rounded-xl flex items-center gap-2 shadow-sm transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Host Another Quiz</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
