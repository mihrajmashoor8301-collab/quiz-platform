"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createQuizSocket, type QuizSocket } from "../../lib/quiz-socket";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Trophy,
  Users,
  Sparkles,
  Zap,
  ArrowRight,
  Crown,
  Medal,
  Award,
  Radio,
  Check,
} from "lucide-react";

const OPTION_STYLES = [
  {
    bg: "bg-[#EF4444] hover:bg-[#E03838]",
    shadow: "shadow-[0_5px_0_0_#B91C1C] active:shadow-[0_1px_0_0_#B91C1C]",
    shape: "▲",
    label: "A",
    border: "border-red-400/30",
  },
  {
    bg: "bg-[#3B82F6] hover:bg-[#2B75F0]",
    shadow: "shadow-[0_5px_0_0_#1D4ED8] active:shadow-[0_1px_0_0_#1D4ED8]",
    shape: "◆",
    label: "B",
    border: "border-blue-400/30",
  },
  {
    bg: "bg-[#F59E0B] hover:bg-[#E59005]",
    shadow: "shadow-[0_5px_0_0_#B45309] active:shadow-[0_1px_0_0_#B45309]",
    shape: "●",
    label: "C",
    border: "border-amber-400/30",
  },
  {
    bg: "bg-[#10B981] hover:bg-[#0EA271]",
    shadow: "shadow-[0_5px_0_0_#047857] active:shadow-[0_1px_0_0_#047857]",
    shape: "■",
    label: "D",
    border: "border-emerald-400/30",
  },
];

function RoomContent() {
  const searchParams = useSearchParams();
  const pin = (searchParams.get("pin") || "").replace(/\D/g, "").slice(0, 6);
  const nickname = searchParams.get("nickname") || "Player";

  const [socket, setSocket] = useState<QuizSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomTitle, setRoomTitle] = useState("Live Arena");

  // Player Game States: "lobby" | "question" | "submitted" | "results" | "finished" | "cancelled"
  const [playerState, setPlayerState] = useState<
    "lobby" | "question" | "submitted" | "results" | "finished" | "cancelled"
  >("lobby");
  const [cancelMessage, setCancelMessage] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const selectedAnswerRef = useRef<string | null>(null);
  const [roundResult, setRoundResult] = useState<any>(null);
  const [myScore, setMyScore] = useState(0);
  const [myRank, setMyRank] = useState(1);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);
  const [finalLeaderboard, setFinalLeaderboard] = useState<any[]>([]);

  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) return;
    let active = true;
    let s: QuizSocket | null = null;
    const connect = async () => {
      const key = `quiz_player_session_${pin}`;
      let saved: { playerId: string; sessionToken: string } | null = null;
      try {
        saved = JSON.parse(localStorage.getItem(key) || "null");
      } catch {}
      if (!saved?.playerId || !saved?.sessionToken) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const sessionToken = btoa(
          Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");
        saved = { playerId: crypto.randomUUID(), sessionToken };
        localStorage.setItem(key, JSON.stringify(saved));
      }
      const response = await fetch(`/api/rooms/${pin}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...saved, nickname }),
      });
      const joined = await response.json();
      if (!response.ok)
        throw new Error(joined.error || "Could not join this quiz room.");
      if (!active) return;
      const client = createQuizSocket(pin);
      s = client;
      client.on("connect", () => {
        setConnected(true);
        client.emit("join-room", {
          roomPin: pin,
          nickname,
          playerId: joined.playerId,
          playerToken: joined.sessionToken,
        });
      });
      client.on("disconnect", () => setConnected(false));
      client.on("connect_error", () => setConnected(false));

      client.on("joined", (data) => {
        if (data.room?.title) setRoomTitle(data.room.title);
        if (data.participant) {
          if (typeof data.participant.score === "number")
            setMyScore(data.participant.score);
          if (data.participant.hasAnswered) {
            selectedAnswerRef.current = data.participant.lastAnswer;
            setSelectedAnswer(data.participant.lastAnswer);
            setPlayerState("submitted");
          }
        }
      });

      client.on("question-started", (data) => {
        setCurrentQuestion(data);
        setTimeRemaining(data.timeRemaining);

        if (data.hasAnswered) {
          selectedAnswerRef.current = data.lastAnswer;
          setSelectedAnswer(data.lastAnswer);
          setPlayerState("submitted");
        } else {
          selectedAnswerRef.current = null;
          setSelectedAnswer(null);
          setWasCorrect(null);
          setPlayerState("question");
        }
      });

      client.on("timer-tick", (data: { timeRemaining: number }) => {
        setTimeRemaining(data.timeRemaining);
      });

      client.on("answer-ack", () => {
        setPlayerState("submitted");
      });

      client.on("question-results", (data) => {
        setRoundResult(data);

        const norm = (str: any) => String(str ?? "").trim().toLowerCase();
        const myAnswer = selectedAnswerRef.current;
        const myEntry = data.leaderboard?.find(
          (p: any) =>
            p.id === client.id ||
            (p.nickname && norm(p.nickname) === norm(nickname))
        );

        let isCorrect = false;
        if (myEntry && typeof myEntry.isCorrect === "boolean") {
          isCorrect = myEntry.isCorrect;
        } else if (myAnswer) {
          isCorrect = Boolean(
            data.correctAnswers?.some((c: string) => norm(c) === norm(myAnswer))
          );
        }

        setWasCorrect(isCorrect);

        if (data.leaderboard) {
          const rankIndex = data.leaderboard.findIndex(
            (p: any) =>
              p.id === client.id ||
              (p.nickname && norm(p.nickname) === norm(nickname))
          );
          if (rankIndex !== -1) {
            setMyRank(rankIndex + 1);
            setMyScore(data.leaderboard[rankIndex].score);
          }
        }

        setPlayerState("results");
      });

      client.on("quiz-finished", (data) => {
        if (data.leaderboard) {
          setFinalLeaderboard(data.leaderboard);
          const norm = (str: any) => String(str ?? "").trim().toLowerCase();
          const rankIndex = data.leaderboard.findIndex(
            (p: any) =>
              p.id === client.id ||
              (p.nickname && norm(p.nickname) === norm(nickname))
          );
          if (rankIndex !== -1) {
            setMyRank(rankIndex + 1);
            setMyScore(data.leaderboard[rankIndex].score);
          }
        }
        setPlayerState("finished");
      });

      client.on("quiz-cancelled", (data: { message?: string }) => {
        setCancelMessage(data?.message || "The host has ended this quiz session.");
        setPlayerState("cancelled");
      });

      setSocket(client);
    };
    connect().catch((error) => {
      if (active)
        setRoomTitle(
          error instanceof Error ? error.message : "Could not join this room."
        );
    });

    return () => {
      active = false;
      s?.disconnect();
    };
  }, [pin, nickname]);

  useEffect(() => {
    if (playerState !== "question" || !currentQuestion?.deadline) return;
    const update = () =>
      setTimeRemaining(
        Math.max(
          0,
          Math.ceil((currentQuestion.deadline - Date.now()) / 1000)
        )
      );
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [playerState, currentQuestion]);

  const handleSubmit = (option: string) => {
    if (playerState !== "question" || !socket || !currentQuestion) return;
    const cleanOption = String(option || "").trim();
    selectedAnswerRef.current = cleanOption;
    setSelectedAnswer(cleanOption);

    socket.emit("submit-answer", {
      questionId: currentQuestion.id,
      answer: cleanOption,
    });
    setPlayerState("submitted");
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Top HUD Telemetry Bar */}
      <div className="bg-white/90 backdrop-blur-md px-5 py-3.5 rounded-2xl shadow-card border border-surface-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              PIN
            </span>
            <span className="font-mono font-bold text-sm tracking-wider text-brand-600">
              {pin}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Live Sync</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="px-3 py-1 rounded-full bg-brand-50 border border-brand-100 text-brand-700 font-display font-semibold text-xs truncate max-w-[120px] sm:max-w-[160px]">
            {nickname}
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-display font-bold text-xs sm:text-sm">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-mono">{myScore}</span>
            <span className="text-[10px] text-amber-600 font-normal">PTS</span>
          </div>
        </div>
      </div>

      {/* State: Lobby */}
      {playerState === "lobby" && (
        <div className="bg-white rounded-3xl shadow-elevated border border-surface-border p-8 sm:p-12 text-center space-y-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-brand-600 to-indigo-400" />

          <div className="w-20 h-20 mx-auto rounded-3xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shadow-inner">
            <Zap className="w-10 h-10 fill-brand-600 animate-pulse" />
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-2 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              Connected to Arena
            </div>
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
              You're In, {nickname}!
            </h1>
            <p className="text-slate-500 mt-2 text-sm sm:text-base max-w-md mx-auto">
              Your name is registered in the arena. Watch the host's screen — questions will appear here instantly when the game begins.
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 inline-flex items-center gap-3 text-slate-600 text-sm font-medium">
            <Radio className="w-4 h-4 text-brand-500 animate-pulse" />
            <span>Waiting for host to launch the round...</span>
          </div>
        </div>
      )}

      {/* State: Active Question */}
      {playerState === "question" && currentQuestion && (
        <div className="bg-white rounded-3xl shadow-elevated border border-surface-border p-6 sm:p-8 space-y-6 relative overflow-hidden">
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-brand-700 bg-brand-50 border border-brand-200/60 px-3 py-1.5 rounded-xl">
              Question {currentQuestion.index + 1} of {currentQuestion.total}
            </span>

            <div
              className={`flex items-center gap-2 font-mono font-bold text-base px-3.5 py-1.5 rounded-xl border transition-colors ${
                timeRemaining <= 5
                  ? "bg-red-50 text-red-600 border-red-200 animate-pulse"
                  : "bg-slate-50 text-slate-700 border-slate-200"
              }`}
            >
              <Clock className="w-4 h-4" />
              <span className="tabular-nums">{timeRemaining}s</span>
            </div>
          </div>

          <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-900 leading-snug">
            {currentQuestion.text}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            {currentQuestion.options.map((opt: string, i: number) => {
              const style = OPTION_STYLES[i % OPTION_STYLES.length];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSubmit(opt)}
                  className={`tactile-press group relative flex flex-col justify-between text-left p-5 rounded-2xl text-white border ${style.bg} ${style.shadow} ${style.border} min-h-[110px] cursor-pointer transition-transform`}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="w-8 h-8 rounded-xl bg-black/20 flex items-center justify-center font-bold text-white shadow-inner text-sm">
                      {style.shape}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/20">
                      {style.label}
                    </span>
                  </div>
                  <span className="font-display font-semibold text-base sm:text-lg text-white leading-tight">
                    {opt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* State: Answer Locked In / Submitted */}
      {playerState === "submitted" && (
        <div className="bg-white rounded-3xl shadow-elevated border border-surface-border p-8 sm:p-12 text-center space-y-6 relative overflow-hidden">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shadow-inner">
            <CheckCircle2 className="w-9 h-9 text-brand-600 animate-bounce" />
          </div>

          <div>
            <h2 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
              Answer Locked In!
            </h2>
            <p className="text-slate-500 mt-2 text-sm sm:text-base">
              You chose:{" "}
              <span className="font-bold text-slate-900 bg-slate-100 px-3 py-1 rounded-xl inline-block mt-1 sm:mt-0">
                "{selectedAnswer}"
              </span>
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 inline-flex items-center gap-3 text-slate-600 text-sm font-medium">
            <Clock className="w-4 h-4 text-brand-500 animate-spin" />
            <span>Waiting for round timer to expire...</span>
          </div>
        </div>
      )}

      {/* State: Round Results */}
      {playerState === "results" && (
        <div
          className={`p-7 sm:p-9 rounded-3xl shadow-elevated border text-center space-y-6 transition-all ${
            wasCorrect
              ? "bg-white border-emerald-300 ring-4 ring-emerald-500/10"
              : "bg-white border-red-300 ring-4 ring-red-500/10"
          }`}
        >
          <div className="inline-flex p-3 rounded-full">
            {wasCorrect ? (
              <div className="p-4 bg-emerald-100 text-emerald-600 rounded-3xl animate-bounce">
                <CheckCircle2 className="w-14 h-14" />
              </div>
            ) : (
              <div className="p-4 bg-rose-100 text-rose-600 rounded-3xl animate-pulse">
                <XCircle className="w-14 h-14" />
              </div>
            )}
          </div>

          <div>
            <h2
              className={`font-display font-extrabold text-3xl tracking-tight ${
                wasCorrect ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {wasCorrect ? "Correct! 🎉" : "Incorrect"}
            </h2>

            {selectedAnswer && (
              <p className="text-slate-600 mt-2 text-sm">
                Your answer:{" "}
                <span className="font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg">
                  {selectedAnswer}
                </span>
              </p>
            )}

            <div className="mt-3">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-400 block mb-1">
                Correct Solution
              </span>
              <span className="font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200 inline-block text-sm">
                {roundResult?.correctAnswers?.join(", ") || "Revealed on host screen"}
              </span>
            </div>
          </div>

          <div className="p-5 bg-slate-50/80 rounded-2xl border border-slate-200 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                Total Score
              </p>
              <p className="font-display font-black text-2xl sm:text-3xl text-slate-900 mt-1">
                {myScore}{" "}
                <span className="text-xs font-semibold text-slate-500">pts</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400">
                Current Rank
              </p>
              <p className="font-display font-black text-2xl sm:text-3xl text-brand-600 mt-1">
                #{myRank}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400 animate-pulse font-medium">
            Next question starting momentarily...
          </p>
        </div>
      )}

      {/* State: Finished (Podium & Leaderboard) */}
      {playerState === "finished" && (
        <div className="bg-white rounded-3xl shadow-elevated border border-surface-border p-8 sm:p-12 text-center space-y-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-brand-500 to-indigo-600" />

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold uppercase tracking-wider mb-3">
              <Crown className="w-3.5 h-3.5 text-amber-500" />
              Grand Final Standings
            </div>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-slate-900 tracking-tight">
              Arena Concluded!
            </h1>
            <p className="text-slate-500 mt-2 text-sm sm:text-base">
              Great game, {nickname}! Here is your official finish.
            </p>
          </div>

          {/* Personal Result Card */}
          <div className="p-6 bg-gradient-to-br from-brand-50 via-white to-indigo-50/40 rounded-3xl border border-brand-200/80 shadow-sm max-w-sm mx-auto">
            <span className="text-xs uppercase font-bold tracking-wider text-brand-600">
              Your Placement
            </span>
            <div className="font-display font-black text-5xl sm:text-6xl text-brand-700 my-2">
              #{myRank}
            </div>
            <div className="font-display font-bold text-lg text-slate-800">
              {myScore} <span className="text-sm font-normal text-slate-500">points</span>
            </div>
          </div>

          {/* Top 3 Podium Highlights if available */}
          {finalLeaderboard.length >= 2 && (
            <div className="pt-2">
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                Arena Podium
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:gap-4 max-w-md mx-auto items-end">
                {/* 2nd Place */}
                <div className="bg-slate-50 p-3 sm:p-4 rounded-2xl border border-slate-200 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs mb-1">
                    🥈 2
                  </div>
                  <span className="font-bold text-xs sm:text-sm text-slate-800 truncate w-full">
                    {finalLeaderboard[1]?.nickname}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {finalLeaderboard[1]?.score} pts
                  </span>
                </div>

                {/* 1st Place */}
                <div className="bg-amber-50 p-4 sm:p-5 rounded-2xl border border-amber-200 flex flex-col items-center scale-105 shadow-sm">
                  <div className="w-9 h-9 rounded-full bg-amber-400 text-amber-950 font-black flex items-center justify-center text-sm mb-1 shadow-xs">
                    👑 1
                  </div>
                  <span className="font-bold text-xs sm:text-sm text-amber-950 truncate w-full">
                    {finalLeaderboard[0]?.nickname}
                  </span>
                  <span className="text-[11px] text-amber-700 font-mono font-bold">
                    {finalLeaderboard[0]?.score} pts
                  </span>
                </div>

                {/* 3rd Place */}
                {finalLeaderboard[2] && (
                  <div className="bg-amber-50/40 p-3 sm:p-4 rounded-2xl border border-amber-100 flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-amber-200 text-amber-900 font-bold flex items-center justify-center text-xs mb-1">
                      🥉 3
                    </div>
                    <span className="font-bold text-xs sm:text-sm text-slate-800 truncate w-full">
                      {finalLeaderboard[2]?.nickname}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {finalLeaderboard[2]?.score} pts
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="pt-2">
            <a
              href="/"
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-display font-bold py-3.5 px-8 rounded-2xl shadow-tactile-brand transition-all text-sm"
            >
              <span>Play Another Arena</span>
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}

      {/* State: Cancelled */}
      {playerState === "cancelled" && (
        <div className="bg-white rounded-3xl shadow-elevated border border-surface-border p-8 sm:p-12 text-center space-y-6 relative overflow-hidden animate-fade-in">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-rose-500 to-amber-500" />
          <div className="w-16 h-16 mx-auto rounded-3xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-inner">
            <XCircle className="w-9 h-9" />
          </div>
          <div>
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
              Quiz Ended by Host
            </h1>
            <p className="text-slate-500 mt-2 text-sm sm:text-base">
              {cancelMessage || "The host has ended this live arena session."}
            </p>
          </div>
          <div className="pt-2">
            <a
              href="/"
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-display font-bold py-3.5 px-8 rounded-2xl shadow-tactile-brand transition-all text-sm"
            >
              <span>Back to Home</span>
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}

      {/* Bottom Status Indicator */}
      <div className="text-center text-xs text-slate-400 flex items-center justify-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            connected ? "bg-emerald-500" : "bg-amber-500 animate-ping"
          }`}
        />
        <span>{connected ? "Connected to Cloudflare Durable Object" : "Connecting..."}</span>
      </div>
    </div>
  );
}

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-xl mx-auto p-12 text-center text-slate-500 bg-white rounded-3xl border border-surface-border">
          Loading quiz room...
        </div>
      }
    >
      <RoomContent />
    </Suspense>
  );
}
