"use client";

import { useState, useEffect } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createQuizSocket, type QuizSocket } from "../../lib/quiz-socket";
import { cloneQuestionsForQuiz } from "../../lib/question-bank-utils";
import QuestionBankManager from "./question-bank-manager";
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
  Zap,
  Layers,
  Settings,
  Rocket,
  LogOut,
  ShieldCheck,
  Radio,
  FileCode,
  HelpCircle,
  ExternalLink,
  StopCircle,
  Pause,
} from "lucide-react";

export interface QuestionItem {
  id?: number;
  question: string;
  options: string[];
  correct: string;
  timeLimit: number;
  explanation?: string;
  [metadata: string]: unknown;
}

export interface Player {
  id: string;
  nickname: string;
  score: number;
  isCorrect?: boolean;
}

const OPTION_THEMES = [
  { bg: "bg-[#EF4444]", text: "text-red-700", light: "bg-red-50", border: "border-red-200", shape: "▲", label: "A" },
  { bg: "bg-[#3B82F6]", text: "text-blue-700", light: "bg-blue-50", border: "border-blue-200", shape: "◆", label: "B" },
  { bg: "bg-[#F59E0B]", text: "text-amber-700", light: "bg-amber-50", border: "border-amber-200", shape: "●", label: "C" },
  { bg: "bg-[#10B981]", text: "text-emerald-700", light: "bg-emerald-50", border: "border-emerald-200", shape: "■", label: "D" },
];

const TIME_PRESETS = [10, 15, 20, 30, 45, 60];

const SAMPLE_PRESETS: QuestionItem[] = [
  {
    question: "What is the primary execution model of Cloudflare Workers isolates?",
    options: [
      "Full OS virtual machine containerization",
      "Pre-forked Node.js child processes",
      "V8 Isolate engines running sandboxes",
      "Shared multi-tenant WebAssembly hosts",
    ],
    correct: "V8 Isolate engines running sandboxes",
    timeLimit: 20,
  },
  {
    question: "Which HTTP status code represents 'Content Too Large'?",
    options: ["413 Content Too Large", "414 URI Too Long", "422 Unprocessable", "507 Insufficient Storage"],
    correct: "413 Content Too Large",
    timeLimit: 20,
  },
  {
    question: "What guarantees strong single-point coordination in Cloudflare Workers?",
    options: ["Workers KV", "Cloudflare Durable Objects", "D1 SQLite Database", "Hyperdrive Gateway"],
    correct: "Cloudflare Durable Objects",
    timeLimit: 20,
  },
];

const STORAGE_KEY_TITLE = "quiz_host_title";
const STORAGE_KEY_CAPACITY = "quiz_host_capacity";
const STORAGE_KEY_GLOBAL_TIME = "quiz_host_global_time";
const STORAGE_KEY_QUESTIONS = "quiz_host_questions";
const STORAGE_KEY_DRAFT = "quiz_host_draft";
const STORAGE_KEY_ACTIVE_ROOM = "quiz_host_active_room";
const STORAGE_KEY_AUTO_ADVANCE = "quiz_host_auto_advance";

function HostDashboard({ session, supabase }: { session: Session; supabase: SupabaseClient }) {
  const [title, setTitle] = useState("My Live Quiz");
  const [maxParticipants, setMaxParticipants] = useState(50);
  const [room, setRoom] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<{ primaryIp?: string; wifiUrl?: string } | null>(null);

  // Auto-advance & Stop Modal States
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [stopModalOpen, setStopModalOpen] = useState(false);

  // Global Time Setting
  const [globalTimeLimit, setGlobalTimeLimit] = useState(20);

  // Configured Questions List
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [questionBankOpen, setQuestionBankOpen] = useState(false);
  const [questionPickerOpen, setQuestionPickerOpen] = useState(false);

  // Question Form State (for adding / editing)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [correctOptionIndex, setCorrectOptionIndex] = useState<number>(0);
  const [questionTimeLimit, setQuestionTimeLimit] = useState(20);

  // Live Game States: "setup" | "lobby" | "question" | "results" | "finished"
  const [socket, setSocket] = useState<QuizSocket | null>(null);
  const [gameState, setGameState] = useState<"setup" | "lobby" | "question" | "results" | "finished">("setup");
  const [players, setPlayers] = useState<Player[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [answerStats, setAnswerStats] = useState({ answered: 0, total: 0 });
  const [roundResults, setRoundResults] = useState<any>(null);
  const [finalLeaderboard, setFinalLeaderboard] = useState<Player[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const getBackendUrl = () => {
    if (typeof window !== "undefined") return window.location.origin;
    return "http://localhost:3000";
  };

  const apiFetch = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${session.access_token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(path, { ...init, headers, cache: "no-store" });
  };

  const syncToServer = (
    updatedQuestions?: QuestionItem[],
    updatedTitle?: string,
    updatedTime?: number
  ) => {
    try {
      apiFetch("/api/saved-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: updatedTitle ?? title,
          maxParticipants,
          globalTimeLimit: updatedTime ?? globalTimeLimit,
          questions: updatedQuestions ?? questions,
        }),
      }).catch(() => {});
    } catch {}
  };

  const connectHostSocket = (roomPin: string, initialRoomObj?: any) => {
    const s = createQuizSocket(roomPin);

    s.on("connect", () => {
      s.emit("join-room", { roomPin, isHost: true, token: session.access_token });
    });

    s.on("host-joined", (data) => {
      setRoom(data.room || initialRoomObj || { pin: roomPin });
      if (data.state === "question") {
        setGameState("question");
      } else if (data.state === "results") {
        setGameState("results");
      } else if (data.state === "finished") {
        setGameState("finished");
      } else {
        setGameState("lobby");
      }
      if (data.players) setPlayers(data.players);
      if (data.questions && data.questions.length > 0) {
        const mappedQuestions: QuestionItem[] = data.questions.map((q: any) => ({
          ...Object.fromEntries(Object.entries(q).filter(([key]) => !["id", "text", "question"].includes(key))),
          question: q.text || (typeof q.question === "string" ? q.question : q.question?.text) || "Question",
          options: q.options || [],
          correct: Array.isArray(q.correct) ? q.correct[0] : q.correct || q.options?.[0] || "",
          timeLimit: q.timeLimit || 20,
        }));
        setQuestions(mappedQuestions);
        try {
          localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(mappedQuestions));
        } catch {}
      }
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

    s.on("quiz-cancelled", () => {
      handleExitToEditor();
    });

    setSocket(s);
    return s;
  };

  const toggleAutoAdvance = (val: boolean) => {
    setAutoAdvance(val);
    try {
      localStorage.setItem(STORAGE_KEY_AUTO_ADVANCE, String(val));
    } catch {}
  };

  // Restore saved state from server and localStorage on mount
  useEffect(() => {
    try {
      const savedAuto = localStorage.getItem(STORAGE_KEY_AUTO_ADVANCE);
      if (savedAuto !== null) setAutoAdvance(savedAuto === "true");

      const savedTitle = localStorage.getItem(STORAGE_KEY_TITLE);
      if (savedTitle) setTitle(savedTitle);

      const savedCapacity = localStorage.getItem(STORAGE_KEY_CAPACITY);
      if (savedCapacity) setMaxParticipants(Number(savedCapacity) || 50);

      const savedTime = localStorage.getItem(STORAGE_KEY_GLOBAL_TIME);
      if (savedTime) {
        const parsed = Number(savedTime);
        if (parsed > 0) {
          setGlobalTimeLimit(parsed);
          setQuestionTimeLimit(parsed);
        }
      }

      const savedQuestions = localStorage.getItem(STORAGE_KEY_QUESTIONS);
      if (savedQuestions) {
        const parsed = JSON.parse(savedQuestions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setQuestions(parsed);
        }
      }

      const savedDraft = localStorage.getItem(STORAGE_KEY_DRAFT);
      if (savedDraft) {
        const draft = JSON.parse(savedDraft);
        if (draft.prompt) setPrompt(draft.prompt);
        if (Array.isArray(draft.options)) setOptions(draft.options);
        if (typeof draft.correctOptionIndex === "number") setCorrectOptionIndex(draft.correctOptionIndex);
        if (draft.timeLimit) setQuestionTimeLimit(draft.timeLimit);
      }
    } catch (e) {
      console.warn("Storage restoration error:", e);
    }

    apiFetch("/api/saved-quiz")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          if (data.title) {
            setTitle(data.title);
            try {
              localStorage.setItem(STORAGE_KEY_TITLE, data.title);
            } catch {}
          }
          if (data.maxParticipants) setMaxParticipants(data.maxParticipants);
          if (data.globalTimeLimit) {
            setGlobalTimeLimit(data.globalTimeLimit);
            setQuestionTimeLimit(data.globalTimeLimit);
          }
          if (Array.isArray(data.questions) && data.questions.length > 0) {
            setQuestions(data.questions);
            try {
              localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(data.questions));
            } catch {}
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setIsLoaded(true);
      });

    try {
      const savedRoom = localStorage.getItem(STORAGE_KEY_ACTIVE_ROOM);
      if (savedRoom) {
        const parsed = JSON.parse(savedRoom);
        if (parsed?.pin) {
          apiFetch(`/api/rooms/${parsed.pin}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              if (data && data.status !== "finished") {
                setRoom(data);
                connectHostSocket(parsed.pin, data);
              } else {
                localStorage.removeItem(STORAGE_KEY_ACTIVE_ROOM);
              }
            })
            .catch(() => {});
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(questions));
      syncToServer(questions, title, globalTimeLimit);
    } catch {}
  }, [questions, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY_TITLE, title);
      syncToServer(questions, title, globalTimeLimit);
    } catch {}
  }, [title, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY_CAPACITY, String(maxParticipants));
    } catch {}
  }, [maxParticipants, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY_GLOBAL_TIME, String(globalTimeLimit));
      syncToServer(questions, title, globalTimeLimit);
    } catch {}
  }, [globalTimeLimit, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      if (prompt.trim() || options.some((o) => o.trim())) {
        localStorage.setItem(
          STORAGE_KEY_DRAFT,
          JSON.stringify({ prompt, options, correctOptionIndex, timeLimit: questionTimeLimit })
        );
      } else {
        localStorage.removeItem(STORAGE_KEY_DRAFT);
      }
    } catch {}
  }, [prompt, options, correctOptionIndex, questionTimeLimit, isLoaded]);

  useEffect(() => {
    fetch("/api/network-info")
      .then((res) => res.json())
      .then((data) => setNetworkInfo(data))
      .catch(() => {});
  }, []);

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
      ...(editingIndex !== null ? questions[editingIndex] : {}),
      question: prompt.trim(),
      options: trimmedOptions.filter((o) => o.length > 0),
      correct: selectedCorrectText,
      timeLimit: Math.max(5, Number(questionTimeLimit) || globalTimeLimit),
    };

    if (editingIndex !== null) {
      setQuestions((prev) => {
        const next = [...prev];
        next[editingIndex] = finalQuestion;
        syncToServer(next);
        return next;
      });
      setEditingIndex(null);
    } else {
      setQuestions((prev) => {
        const next = [...prev, finalQuestion];
        syncToServer(next);
        return next;
      });
    }

    setPrompt("");
    setOptions(["", "", "", ""]);
    setCorrectOptionIndex(0);
    setQuestionTimeLimit(globalTimeLimit);
    try {
      localStorage.removeItem(STORAGE_KEY_DRAFT);
    } catch {}
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
    setQuestions((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      syncToServer(next);
      return next;
    });
  };

  const handleMoveQuestion = (idx: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= questions.length) return;

    setQuestions((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = temp;
      syncToServer(next);
      return next;
    });
  };

  const handleLoadSampleQuiz = () => {
    setQuestions(SAMPLE_PRESETS);
    syncToServer(SAMPLE_PRESETS);
    setError("");
  };

  const handleClearAllQuestions = () => {
    if (confirm("Are you sure you want to clear all questions? This will reset your question list.")) {
      setQuestions([]);
      syncToServer([]);
      setEditingIndex(null);
      setPrompt("");
      setOptions(["", "", "", ""]);
      setCorrectOptionIndex(0);
      try {
        localStorage.removeItem(STORAGE_KEY_QUESTIONS);
        localStorage.removeItem(STORAGE_KEY_DRAFT);
      } catch {}
    }
  };

  const handleExitToEditor = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    try {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_ROOM);
    } catch {}
    setGameState("setup");
    setRoom(null);
    setActiveQuestion(null);
    setRoundResults(null);
    setStopModalOpen(false);
    setAutoCountdown(null);
    setAutoPaused(false);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (questions.length === 0) {
      setError("Please add at least 1 question before launching the game lobby.");
      return;
    }

    setLoading(true);

    try {
      const savedRes = await apiFetch("/api/saved-quiz", {
        method: "POST",
        body: JSON.stringify({ title, maxParticipants, globalTimeLimit, questions }),
      });
      if (!savedRes.ok) throw new Error((await savedRes.json()).error || "Could not save quiz.");

      const res = await apiFetch("/api/rooms", {
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

      try {
        localStorage.setItem(
          STORAGE_KEY_ACTIVE_ROOM,
          JSON.stringify({ pin: created.pin, title: created.title })
        );
      } catch {}

      connectHostSocket(created.pin, created);
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
    setAutoCountdown(null);
    setAutoPaused(false);
    socket.emit("next-question");
  };

  const handleCloseQuestion = () => {
    if (!socket) return;
    socket.emit("close-question");
  };

  const handleCancelOngoingQuiz = () => {
    if (socket) {
      socket.emit("cancel-quiz");
    }
    setStopModalOpen(false);
    handleExitToEditor();
  };

  const handleFinishQuizEarly = () => {
    if (socket) {
      socket.emit("finish-quiz");
    }
    setStopModalOpen(false);
  };

  useEffect(() => {
    if (gameState !== "results" || !roundResults || !autoAdvance || autoPaused) {
      setAutoCountdown(null);
      return;
    }

    setAutoCountdown(3);
    const timer = setInterval(() => {
      setAutoCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(timer);
          if (socket) {
            socket.emit("next-question");
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, roundResults, autoAdvance, autoPaused, socket]);

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

  const hostUsername = session.user.email?.split("@")[0] || "Host";

  return (
    <div className="w-full space-y-6 pb-14">
      {/* Top Host Command Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white/90 backdrop-blur-md px-5 py-3 rounded-2xl border border-surface-border shadow-card">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-200/60 flex items-center justify-center font-display font-black text-brand-600 text-sm">
            {hostUsername[0].toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-slate-900 text-sm">
                {session.user.email}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Durable Object Active
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Host Console • Supabase Authenticated</p>
          </div>
        </div>

        <button
          type="button"
          onClick={async () => {
            socket?.disconnect();
            await supabase.auth.signOut();
          }}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition self-end sm:self-auto"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* ----------------- SETUP VIEW: QUESTION BANK FULL SCREEN ----------------- */}
      {gameState === "setup" && questionBankOpen && (
        <QuestionBankManager apiFetch={apiFetch} mode="manage" onClose={() => setQuestionBankOpen(false)} />
      )}

      {/* ----------------- SETUP VIEW: QUIZ BUILDER & HOST DASHBOARD ----------------- */}
      {gameState === "setup" && !questionBankOpen && (
        <div className="space-y-6 animate-fade-in">
          {/* Welcome Banner matching quizplatform_host_dashboard/code.html */}
          <div className="bg-gradient-to-r from-white via-white to-brand-50/50 rounded-3xl border border-surface-border p-6 sm:p-8 shadow-card flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-brand-600 to-indigo-400" />
            <div className="space-y-1.5 max-w-xl">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 border border-brand-200/60 text-brand-700 text-xs font-bold uppercase tracking-wider mb-1">
                <Zap className="w-3.5 h-3.5 text-brand-600" />
                <span>Executive Host Studio</span>
              </div>
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
                Welcome back, {hostUsername}! 👋
              </h1>
              <p className="text-slate-500 text-sm">
                Live Arena Engine • Cloudflare Workers & Supabase Cluster. Configure your questions or launch the real-time arena.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setQuestionBankOpen(true)}
                className="px-4 py-2.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs sm:text-sm font-bold flex items-center gap-2 transition"
              >
                <Layers className="w-4 h-4 text-brand-600" />
                <span>Question Bank Vault</span>
              </button>
              {questions.length === 0 && (
                <button
                  type="button"
                  onClick={handleLoadSampleQuiz}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 transition shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Load Sample Trivia</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Metrics KPI Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-surface-border shadow-card">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Total Questions
              </span>
              <div className="font-display font-black text-2xl sm:text-3xl text-slate-900 mt-1">
                {questions.length}
              </div>
              <span className="text-xs text-brand-600 font-semibold mt-0.5 block">Ready for arena</span>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-surface-border shadow-card">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Est. Duration
              </span>
              <div className="font-display font-black text-2xl sm:text-3xl text-slate-900 mt-1">
                ~{questions.reduce((a, b) => a + (b.timeLimit || 20), 0)}s
              </div>
              <span className="text-xs text-slate-500 font-medium mt-0.5 block">Total playtime</span>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-surface-border shadow-card">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Timer Preset
              </span>
              <div className="font-display font-black text-2xl sm:text-3xl text-brand-600 mt-1">
                {globalTimeLimit}s
              </div>
              <span className="text-xs text-slate-500 font-medium mt-0.5 block">Per question default</span>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-surface-border shadow-card">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Max Capacity
              </span>
              <div className="font-display font-black text-2xl sm:text-3xl text-slate-900 mt-1">
                {maxParticipants}
              </div>
              <span className="text-xs text-emerald-600 font-semibold mt-0.5 block">Concurrent players</span>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2.5 animate-shake">
              <XCircle className="w-5 h-5 flex-shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Room Details & Settings Card */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-surface-border shadow-card space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-surface-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <h2 className="font-display font-extrabold text-lg text-slate-900">
                  Room Configuration & Global Timer
                </h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">Step 1 of 3</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Quiz Arena Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Cloudflare Architecture & Full-Stack Trivia"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Max Participants
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>

            {/* Global Timer Presets Bar */}
            <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Default Question Timer
                </span>
                <span className="text-xs text-slate-500">
                  Apply a standard countdown limit across all questions
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {TIME_PRESETS.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    onClick={() => handleApplyTimeToAll(seconds)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      globalTimeLimit === seconds
                        ? "bg-brand-500 text-white shadow-xs"
                        : "bg-white text-slate-700 border border-slate-200 hover:border-brand-300"
                    }`}
                  >
                    {seconds}s
                  </button>
                ))}
                <div className="flex items-center gap-1.5 ml-1">
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={globalTimeLimit}
                    onChange={(e) => setGlobalTimeLimit(Math.max(5, Number(e.target.value)))}
                    className="w-16 px-2.5 py-1 text-xs border border-slate-300 rounded-lg text-center font-bold bg-white"
                  />
                  <span className="text-xs text-slate-500 font-medium">sec</span>
                  <button
                    type="button"
                    onClick={() => handleApplyTimeToAll(globalTimeLimit)}
                    className="ml-1 px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition"
                  >
                    Apply All
                  </button>
                </div>
              </div>
            </div>

            {/* Auto-Advance Setting Bar */}
            <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  Auto-Advance Between Questions
                </span>
                <span className="text-xs text-slate-500">
                  Automatically move to the next question with a 3-second countdown break after round results
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoAdvance}
                  onChange={(e) => toggleAutoAdvance(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
              </label>
            </div>
          </div>

          {/* Section 2: Create / Edit Question Builder Card */}
          <form
            onSubmit={handleSaveQuestion}
            className={`p-6 sm:p-7 rounded-3xl border shadow-card space-y-5 transition-all ${
              editingIndex !== null
                ? "bg-brand-50/40 border-brand-300 ring-4 ring-brand-500/10"
                : "bg-white border-surface-border"
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-surface-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <h2 className="font-display font-extrabold text-lg text-slate-900 flex items-center gap-2">
                  <span>{editingIndex !== null ? `Edit Question #${editingIndex + 1}` : "Create Question"}</span>
                  {editingIndex !== null && (
                    <span className="text-xs font-bold bg-brand-600 text-white px-2.5 py-0.5 rounded-full">
                      Editing
                    </span>
                  )}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Timer:</label>
                <select
                  value={questionTimeLimit}
                  onChange={(e) => setQuestionTimeLimit(Number(e.target.value))}
                  className="px-3 py-1 text-xs font-bold border border-slate-300 rounded-xl bg-white"
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

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Question Prompt
              </label>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Which protocol does Cloudflare Durable Objects use for real-time sync?"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm sm:text-base font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                required
              />
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Answer Options & Correct Key
                </label>
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Select button to mark correct answer
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {options.map((opt, i) => {
                  const theme = OPTION_THEMES[i];
                  const isCorrect = correctOptionIndex === i;

                  return (
                    <div
                      key={i}
                      className={`relative flex items-center p-3 rounded-2xl border-2 transition-all ${
                        isCorrect
                          ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/20 shadow-xs"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span
                        className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-white text-xs mr-3 flex-shrink-0 ${theme.bg}`}
                      >
                        {theme.shape}
                      </span>

                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const updated = [...options];
                          updated[i] = e.target.value;
                          setOptions(updated);
                        }}
                        placeholder={`Option ${theme.label} ${i < 2 ? "(required)" : "(optional)"}`}
                        className="flex-1 bg-transparent border-0 text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none placeholder:text-slate-400 mr-2"
                        required={i < 2}
                      />

                      <button
                        type="button"
                        onClick={() => setCorrectOptionIndex(i)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                          isCorrect
                            ? "bg-emerald-600 text-white shadow-xs"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                        }`}
                        title="Mark this option as correct"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isCorrect ? "Correct ✓" : "Mark Key"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

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
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-semibold transition"
                >
                  Cancel Edit
                </button>
              )}

              <button
                type="submit"
                className="tactile-press bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-display font-bold py-2.5 px-6 rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-tactile-brand transition"
              >
                <Plus className="w-4 h-4" />
                <span>{editingIndex !== null ? "Save Changes" : "Add Question to Quiz"}</span>
              </button>
            </div>
          </form>

          {/* Section 3: Configured Questions List Preview */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-surface-border shadow-card space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-surface-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold text-xs">
                  3
                </div>
                <div>
                  <h2 className="font-display font-extrabold text-lg text-slate-900">
                    Configured Questions ({questions.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    {questions.length > 0
                      ? `Arena duration: ~${questions.reduce((a, b) => a + (b.timeLimit || 20), 0)}s total`
                      : "Add questions using the builder or import from Question Bank."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuestionPickerOpen(true)}
                  disabled={questions.length >= 50}
                  className="px-3.5 py-1.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-40"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Import from Bank</span>
                </button>
                {questions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllQuestions}
                    className="text-xs text-slate-400 hover:text-rose-600 font-semibold flex items-center gap-1 transition p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>
            </div>

            {questions.length === 0 ? (
              <div className="p-10 text-center border-2 border-dashed border-slate-200 rounded-3xl space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 mx-auto flex items-center justify-center">
                  <Plus className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-800 text-base">No questions added yet</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Create custom questions above, import questions from your Question Bank, or load sample trivia.
                  </p>
                </div>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleLoadSampleQuiz}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span>Load Sample Trivia</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {questions.map((q, idx) => (
                  <div
                    key={idx}
                    className="p-4 sm:p-5 rounded-2xl border border-surface-border bg-slate-50/70 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold uppercase text-brand-700 bg-brand-100 px-2.5 py-0.5 rounded-lg">
                          Q{idx + 1}
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-500 flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {q.timeLimit}s
                        </span>
                        <span className="text-sm font-display font-bold text-slate-900 ml-1">
                          {q.question}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {q.options.map((opt, oIdx) => {
                          const isCorrect = opt === q.correct;
                          return (
                            <span
                              key={oIdx}
                              className={`text-xs px-2.5 py-1 rounded-xl border flex items-center gap-1.5 font-medium ${
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

                    <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
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
                        className="p-1.5 text-brand-600 hover:bg-brand-50 rounded-lg transition"
                        title="Edit Question"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuestion(idx)}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition"
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
            <div className="pt-4 border-t border-surface-border flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-xs text-slate-500">
                {questions.length > 0
                  ? `Ready to broadcast ${questions.length} question${questions.length > 1 ? "s" : ""} to live participants.`
                  : "Add at least 1 question to launch game."}
              </span>

              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={loading || questions.length === 0}
                className="tactile-press w-full sm:w-auto bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-display font-bold py-3.5 px-8 rounded-2xl flex items-center justify-center gap-2.5 shadow-tactile-brand transition disabled:opacity-40 disabled:cursor-not-allowed text-base"
              >
                <Play className="w-5 h-5 fill-white" />
                <span>{loading ? "Generating PIN..." : "Launch Game PIN & Lobby"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Select Modal from Question Bank */}
      {gameState === "setup" && questionPickerOpen && (
        <QuestionBankManager
          apiFetch={apiFetch}
          mode="select"
          maxSelection={Math.max(0, 50 - questions.length)}
          onClose={() => setQuestionPickerOpen(false)}
          onImport={(bankQuestions) => {
            const imported: QuestionItem[] = cloneQuestionsForQuiz(bankQuestions).map((question) => ({
              ...question,
              question: String(question.question ?? question.text ?? ""),
              options: Array.isArray(question.options) ? question.options.map(String) : [],
              correct: String(question.correct ?? ""),
              timeLimit: Number(question.timeLimit ?? globalTimeLimit),
            }));
            setQuestions((current) => [...current, ...imported]);
            setQuestionPickerOpen(false);
          }}
        />
      )}

      {/* ----------------- LOBBY VIEW matching quizplatform_live_host_arena_lobby/code.html ----------------- */}
      {gameState === "lobby" && room && (
        <div className="bg-white p-8 sm:p-12 rounded-3xl shadow-elevated border border-surface-border text-center space-y-8 animate-fade-in relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-brand-600 via-indigo-500 to-emerald-400" />

          <div>
            <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 text-xs font-bold uppercase tracking-widest px-3.5 py-1.5 rounded-full border border-brand-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span>Live Arena Lobby Open</span>
            </div>

            {/* Direct Join Link Bar */}
            <div className="max-w-lg mx-auto mt-4 p-4 rounded-2xl bg-brand-50/70 border border-brand-200 text-brand-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left shadow-xs">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-brand-500 text-white rounded-xl shadow-xs">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600 block">
                    Join URL on mobile / laptop:
                  </span>
                  <span className="font-mono font-black text-base text-slate-800 select-all">
                    {networkInfo?.wifiUrl || getBackendUrl()}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQr(!showQr)}
                className="px-3.5 py-2 bg-white border border-brand-200 hover:bg-brand-100 rounded-xl text-xs font-bold text-brand-700 flex items-center gap-1.5 transition shadow-xs flex-shrink-0"
              >
                <QrCode className="w-4 h-4" />
                <span>{showQr ? "Hide QR" : "Show QR Code"}</span>
              </button>
            </div>

            {/* QR Code Popup */}
            {showQr && (
              <div className="mt-4 p-5 bg-white border-2 border-brand-200 rounded-3xl shadow-modal inline-block animate-fade-in">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    `${networkInfo?.wifiUrl || getBackendUrl()}/?pin=${room.pin}`
                  )}`}
                  alt="Scan QR code to join"
                  className="w-44 h-44 mx-auto rounded-2xl p-1 bg-white border border-slate-200"
                />
                <p className="text-xs font-bold text-brand-700 mt-2.5">
                  Point phone camera to join instantly!
                </p>
              </div>
            )}

            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mt-6">
              Enter 6-Digit Game PIN:
            </p>
            <div className="text-7xl sm:text-8xl font-black font-mono tracking-widest text-brand-600 mt-1 select-all drop-shadow-sm">
              {room.pin}
            </div>

            <div className="flex items-center justify-center gap-3 mt-5">
              <button
                onClick={handleCopyPin}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
              >
                {copiedPin ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedPin ? "PIN Copied!" : "Copy PIN"}</span>
              </button>
              <button
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-xs transition shadow-xs"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? "Link Copied!" : "Copy Direct Join Link"}</span>
              </button>
            </div>
          </div>

          <div className="py-6 border-y border-slate-100">
            <div className="flex items-center justify-center gap-2 text-slate-700 font-display font-bold mb-4">
              <Users className="w-5 h-5 text-brand-600" />
              <span>Joined Arena Participants ({players.length})</span>
            </div>

            {players.length === 0 ? (
              <div className="py-8 text-slate-400 animate-pulse text-sm">
                Waiting for players to enter PIN {room.pin} and join...
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2.5 max-w-lg mx-auto">
                {players.map((p, i) => (
                  <span
                    key={i}
                    className="bg-brand-50 border border-brand-200 text-brand-900 font-display font-bold px-4 py-2 rounded-2xl text-sm shadow-xs animate-fade-in"
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
                  handleCancelOngoingQuiz();
                }
              }}
              className="px-6 py-3.5 rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-sm transition"
            >
              Back to Editor
            </button>

            <button
              onClick={handleStartQuiz}
              className="tactile-press bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-display font-black py-4 px-12 rounded-2xl text-lg flex items-center gap-3 shadow-tactile-emerald transition"
            >
              <Play className="w-6 h-6 fill-white" />
              <span>Start Arena ({questions.length} Questions)</span>
            </button>
          </div>
        </div>
      )}

      {/* ----------------- QUESTION VIEW: LIVE HOST ARENA ----------------- */}
      {gameState === "question" && activeQuestion && (
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-elevated border border-surface-border space-y-6 animate-fade-in relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-700 bg-brand-50 px-3 py-1.5 rounded-xl border border-brand-200/60">
              Question {activeQuestion.index + 1} of {activeQuestion.total}
            </span>
            <div className="flex items-center gap-2 text-rose-600 font-mono font-bold text-xl bg-rose-50 px-4 py-1.5 rounded-xl border border-rose-200 animate-pulse">
              <Clock className="w-5 h-5" />
              <span>{timeRemaining}s</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              className="bg-brand-500 h-3 rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${Math.max(0, Math.min(100, (timeRemaining / (activeQuestion.timeLimit || 20)) * 100))}%`,
              }}
            />
          </div>

          <h2 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 leading-snug">
            {activeQuestion.text}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {activeQuestion.options.map((opt: string, i: number) => {
              const theme = OPTION_THEMES[i % 4];
              return (
                <div
                  key={i}
                  className={`p-6 rounded-2xl font-display font-bold text-lg sm:text-xl flex items-center gap-4 ${theme.bg} text-white shadow-sm`}
                >
                  <span className="text-2xl opacity-80">{theme.shape}</span>
                  <span>{opt}</span>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-600">
              Answers received:{" "}
              <span className="text-brand-600 font-bold text-base">
                {answerStats.answered}
              </span>{" "}
              / {players.length}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStopModalOpen(true)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-semibold py-2.5 px-4 rounded-xl text-xs sm:text-sm transition flex items-center gap-1.5"
                title="Stop or cancel this live quiz"
              >
                <StopCircle className="w-4 h-4 text-rose-500" />
                <span>Stop Quiz</span>
              </button>

              <button
                type="button"
                onClick={handleCloseQuestion}
                className="bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2.5 px-5 rounded-xl text-xs sm:text-sm transition"
              >
                End Question Early
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- RESULTS VIEW: ROUND RESULTS & LEADERBOARD ----------------- */}
      {gameState === "results" && roundResults && (
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-elevated border border-surface-border space-y-6 animate-fade-in">
          {/* Auto-advance Countdown Banner */}
          {autoAdvance && autoCountdown !== null && !autoPaused && (
            <div className="bg-brand-50 border border-brand-200/80 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-brand-900 font-medium animate-fade-in">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-brand-600"></span>
                </span>
                <span>
                  Auto-advancing to {roundResults.hasNext ? "next question" : "final podium"} in{" "}
                  <strong className="text-brand-700 font-extrabold text-sm">{autoCountdown}s</strong>...
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAutoPaused(true)}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-brand-200 rounded-xl text-brand-700 font-bold transition flex items-center gap-1.5 shadow-xs"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Break</span>
                </button>
                <button
                  type="button"
                  onClick={handleNextQuestion}
                  className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold transition flex items-center gap-1 shadow-xs"
                >
                  <span>Skip Countdown</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-surface-border">
            <h2 className="font-display font-extrabold text-xl sm:text-2xl text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 flex-shrink-0" />
              <span>Correct Solution: {roundResults.correctAnswers?.join(", ")}</span>
            </h2>

            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => setStopModalOpen(true)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-semibold py-2.5 px-3.5 rounded-xl text-xs sm:text-sm transition flex items-center gap-1.5"
                title="Stop or cancel this live quiz"
              >
                <StopCircle className="w-4 h-4 text-rose-500" />
                <span>Stop Quiz</span>
              </button>

              {/* Auto-Advance toggle & pause control */}
              <div className="flex items-center gap-2 bg-slate-100 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 border border-slate-200">
                <span className="text-slate-500">Auto-advance:</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !autoAdvance;
                    toggleAutoAdvance(next);
                    if (!next) {
                      setAutoCountdown(null);
                    }
                  }}
                  className={`px-2 py-0.5 rounded-md font-bold text-xs transition ${
                    autoAdvance ? "bg-brand-500 text-white" : "bg-slate-300 text-slate-700"
                  }`}
                >
                  {autoAdvance ? "ON" : "OFF"}
                </button>
                {autoAdvance && autoCountdown !== null && !autoPaused && (
                  <button
                    type="button"
                    onClick={() => setAutoPaused(true)}
                    className="ml-1 text-amber-600 hover:text-amber-700 font-bold flex items-center gap-1 text-xs"
                    title="Pause auto-advance timer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause ({autoCountdown}s)</span>
                  </button>
                )}
                {autoAdvance && autoPaused && (
                  <button
                    type="button"
                    onClick={() => setAutoPaused(false)}
                    className="ml-1 text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 text-xs"
                    title="Resume auto-advance timer"
                  >
                    <Play className="w-3.5 h-3.5 fill-emerald-600" />
                    <span>Resume</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleNextQuestion}
                className="tactile-press bg-brand-500 hover:bg-brand-600 text-white font-display font-bold py-2.5 px-6 rounded-xl flex items-center gap-2 transition shadow-tactile-brand text-sm"
              >
                <span>
                  {autoAdvance && autoCountdown !== null && !autoPaused
                    ? `Next (${autoCountdown}s)`
                    : roundResults.hasNext
                    ? "Next Question"
                    : "See Final Champion Podium"}
                </span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Option Distribution */}
          <div className="p-5 bg-slate-50/80 rounded-2xl border border-slate-200">
            <h3 className="text-xs uppercase font-bold text-slate-500 mb-3 tracking-wider">
              Participant Answer Distribution
            </h3>
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

          {/* Current Leaderboard Standings */}
          <div>
            <h3 className="font-display font-extrabold text-lg text-slate-900 mb-3 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span>Current Leaderboard Standings</span>
            </h3>
            <div className="divide-y divide-slate-100 border border-surface-border rounded-2xl overflow-hidden shadow-card">
              {players.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-white">
                  <div className="flex items-center gap-3">
                    <span className="w-7 font-bold text-slate-400 text-center">#{i + 1}</span>
                    <span className="font-semibold text-slate-800">{p.nickname}</span>
                    {p.isCorrect && (
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
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

      {/* ----------------- FINISHED PODIUM VIEW matching quizplatform_post_game_podium_leaderboard/code.html ----------------- */}
      {gameState === "finished" && (
        <div className="bg-white p-8 sm:p-12 rounded-3xl shadow-elevated border border-surface-border text-center space-y-8 animate-fade-in relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-brand-500 to-indigo-600" />

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold uppercase tracking-wider mb-2">
              <Crown className="w-3.5 h-3.5 text-amber-500" />
              Grand Final Standings
            </div>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-slate-900 tracking-tight">
              Champion of the Arena!
            </h1>
            <p className="text-slate-500 mt-2 text-sm sm:text-base">
              All questions completed. Here are the finalists who achieved master-class precision under time pressure:
            </p>
          </div>

          {/* 3D Isometric Podium Stage (Rank 2 Silver, Rank 1 Gold, Rank 3 Bronze) */}
          {finalLeaderboard.length >= 2 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end max-w-2xl mx-auto pt-6 pb-2">
              {/* Rank 2: Silver */}
              <div className="flex flex-col items-center order-2 md:order-1">
                <div className="w-14 h-14 rounded-full border-4 border-slate-300 bg-slate-100 flex items-center justify-center text-xl mb-2 shadow-sm">
                  🥈
                </div>
                <span className="font-display font-bold text-slate-800 text-base">
                  {finalLeaderboard[1]?.nickname}
                </span>
                <span className="text-xs text-slate-500 font-mono mt-0.5">
                  {finalLeaderboard[1]?.score} pts
                </span>
                <div className="w-full h-32 bg-gradient-to-b from-slate-200 to-slate-300 rounded-t-2xl mt-3 flex items-center justify-center font-display font-black text-slate-500 text-2xl shadow-inner">
                  2
                </div>
              </div>

              {/* Rank 1: Gold (Center Elevated) */}
              <div className="flex flex-col items-center order-1 md:order-2">
                <div className="w-18 h-18 rounded-full border-4 border-amber-400 bg-amber-100 flex items-center justify-center text-3xl mb-2 shadow-md scale-110">
                  👑
                </div>
                <span className="font-display font-extrabold text-amber-950 text-lg">
                  {finalLeaderboard[0]?.nickname}
                </span>
                <span className="text-xs text-amber-700 font-mono font-bold mt-0.5">
                  {finalLeaderboard[0]?.score} pts
                </span>
                <div className="w-full h-44 bg-gradient-to-b from-amber-300 to-amber-400 rounded-t-2xl mt-3 flex items-center justify-center font-display font-black text-amber-900 text-3xl shadow-inner">
                  1
                </div>
              </div>

              {/* Rank 3: Bronze */}
              <div className="flex flex-col items-center order-3 md:order-3">
                <div className="w-14 h-14 rounded-full border-4 border-amber-600/40 bg-amber-50 flex items-center justify-center text-xl mb-2 shadow-sm">
                  🥉
                </div>
                <span className="font-display font-bold text-slate-800 text-base">
                  {finalLeaderboard[2]?.nickname || "—"}
                </span>
                <span className="text-xs text-slate-500 font-mono mt-0.5">
                  {finalLeaderboard[2]?.score ?? 0} pts
                </span>
                <div className="w-full h-24 bg-gradient-to-b from-amber-200 to-amber-300 rounded-t-2xl mt-3 flex items-center justify-center font-display font-black text-amber-800 text-xl shadow-inner">
                  3
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-md mx-auto divide-y divide-slate-100 border border-surface-border rounded-2xl overflow-hidden shadow-card">
              {finalLeaderboard.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-white">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">#{idx + 1}</span>
                    <span className="font-bold text-slate-800">{p.nickname}</span>
                  </div>
                  <span className="font-mono font-bold text-brand-600">{p.score} pts</span>
                </div>
              ))}
            </div>
          )}

          {/* Full Leaderboard Table if more than 3 players */}
          {finalLeaderboard.length > 3 && (
            <div className="max-w-xl mx-auto pt-4 text-left">
              <h3 className="font-display font-bold text-xs uppercase tracking-wider text-slate-400 mb-2">
                All Participants ({finalLeaderboard.length})
              </h3>
              <div className="divide-y divide-slate-100 border border-surface-border rounded-2xl overflow-hidden shadow-xs">
                {finalLeaderboard.slice(3).map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3.5 bg-white text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-400 text-xs w-6 text-center">
                        #{idx + 4}
                      </span>
                      <span className="font-medium text-slate-800">{p.nickname}</span>
                    </div>
                    <span className="font-mono font-semibold text-slate-600">{p.score} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 flex items-center justify-center gap-3">
            <button
              onClick={handleExitToEditor}
              className="tactile-press bg-brand-500 hover:bg-brand-600 text-white font-display font-bold py-3.5 px-8 rounded-2xl flex items-center gap-2 shadow-tactile-brand transition text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Host Another Quiz / Edit Questions</span>
            </button>
          </div>
        </div>
      )}

      {/* Stop / Cancel Quiz Modal */}
      {stopModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-surface-border max-w-lg w-full p-6 sm:p-8 space-y-6 animate-scale-up">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 border border-rose-200 flex items-center justify-center flex-shrink-0 text-rose-600">
                <StopCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-extrabold text-xl text-slate-900">
                  Stop Ongoing Quiz?
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Choose how you would like to end this session:
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Option 1: Finish Early & Show Podium */}
              <button
                type="button"
                onClick={handleFinishQuizEarly}
                className="w-full text-left p-4 rounded-2xl border border-slate-200 hover:border-brand-500 hover:bg-brand-50/50 transition flex items-center justify-between group"
              >
                <div className="space-y-1">
                  <div className="font-display font-bold text-slate-900 group-hover:text-brand-600 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <span>End Quiz & Show Final Standings</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Stops further questions, locks current scores, and displays the podium champion screen to all participants.
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-brand-600 flex-shrink-0 ml-3" />
              </button>

              {/* Option 2: Cancel Quiz Entirely */}
              <button
                type="button"
                onClick={handleCancelOngoingQuiz}
                className="w-full text-left p-4 rounded-2xl border border-rose-100 hover:border-rose-400 hover:bg-rose-50/50 transition flex items-center justify-between group"
              >
                <div className="space-y-1">
                  <div className="font-display font-bold text-rose-600 flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-rose-500" />
                    <span>Cancel Quiz & Return to Editor</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Terminates the room immediately. Participants are notified that the session ended, and you return to edit questions.
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-rose-400 group-hover:text-rose-600 flex-shrink-0 ml-3" />
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setStopModalOpen(false)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold text-sm transition"
              >
                Resume Quiz
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HostPage() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;
    fetch("/api/config", { cache: "no-store" })
      .then(async (response) => {
        const config = await response.json();
        if (!response.ok) throw new Error(config.error || "Could not load authentication settings.");
        const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        });
        if (!active) return;
        setSupabase(client);
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (active) setSession(data.session);
        const listener = client.auth.onAuthStateChange((_event, currentSession) => {
          if (active) setSession(currentSession);
        });
        subscription = listener.data.subscription;
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load authentication settings.");
      })
      .finally(() => {
        if (active) setInitializing(false);
      });
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!supabase) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      if (creatingAccount) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/host` },
        });
        if (authError) throw authError;
        if (!data.session) setNotice("Check your email to confirm your account, then sign in here.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (initializing) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-3xl border border-surface-border bg-white p-8 text-center text-slate-500 shadow-card flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <span className="font-medium text-sm">Loading host sign-in…</span>
      </div>
    );
  }

  if (session && supabase) return <HostDashboard session={session} supabase={supabase} />;

  return (
    <div className="w-full max-w-md mx-auto my-8 sm:my-14">
      {/* Decorative Pill */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200/60 shadow-xs">
          <Zap className="w-3.5 h-3.5 text-brand-600 fill-brand-600" />
          <span className="text-xs font-bold uppercase tracking-wider text-brand-700">
            Host Portal • Supabase Auth
          </span>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-elevated border border-surface-border p-7 sm:p-9 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-brand-600 via-brand-500 to-indigo-400" />

        <div className="text-center mb-8">
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
            {creatingAccount ? "Create Host Account" : "Host Sign In"}
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            {creatingAccount
              ? "Register to configure private question banks and host live arenas."
              : "Sign in with your host credentials to access your quiz studio."}
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2.5 animate-shake">
            <span className="font-bold">!</span>
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div role="status" className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block font-display text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="host@example.com"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition"
            />
          </div>

          <div>
            <label className="block font-display text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Password
            </label>
            <input
              type="password"
              autoComplete={creatingAccount ? "new-password" : "current-password"}
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition"
            />
          </div>

          <button
            disabled={submitting || !supabase}
            className="w-full mt-2 tactile-press bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-display font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 shadow-tactile-brand transition disabled:opacity-50 text-sm"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span>{creatingAccount ? "Create Host Account" : "Sign In to Studio"}</span>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-100 text-center">
          <button
            type="button"
            onClick={() => {
              setCreatingAccount((value) => !value);
              setError("");
              setNotice("");
            }}
            className="font-display text-xs sm:text-sm font-bold text-brand-600 hover:text-brand-700 hover:underline transition-colors"
          >
            {creatingAccount
              ? "Already have an account? Sign In"
              : "Don't have an account? Register as Host"}
          </button>
        </div>
      </div>
    </div>
  );
}
