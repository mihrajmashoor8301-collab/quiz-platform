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
} from "lucide-react";

function RoomContent() {
  const searchParams = useSearchParams();
  const pin = (searchParams.get("pin") || "").replace(/\D/g, "").slice(0, 6);
  const nickname = searchParams.get("nickname") || "Player";

  const [socket, setSocket] = useState<QuizSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomTitle, setRoomTitle] = useState("Live Quiz");

  // Player Game States: "lobby" | "question" | "submitted" | "results" | "finished"
  const [playerState, setPlayerState] = useState<"lobby" | "question" | "submitted" | "results" | "finished">("lobby");
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const selectedAnswerRef = useRef<string | null>(null);
  const [roundResult, setRoundResult] = useState<any>(null);
  const [myScore, setMyScore] = useState(0);
  const [myRank, setMyRank] = useState(1);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);

  useEffect(() => {
    if (!/^\d{6}$/.test(pin)) return;
    let active = true;
    let s: QuizSocket | null = null;
    const connect = async () => {
      const key = `quiz_player_session_${pin}`;
      let saved: { playerId: string; sessionToken: string } | null = null;
      try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
      if (!saved?.playerId || !saved?.sessionToken) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const sessionToken = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("") )
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        saved = { playerId: crypto.randomUUID(), sessionToken };
        localStorage.setItem(key, JSON.stringify(saved));
      }
      const response = await fetch(`/api/rooms/${pin}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...saved, nickname }),
      });
      const joined = await response.json();
      if (!response.ok) throw new Error(joined.error || "Could not join this quiz room.");
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
        if (typeof data.participant.score === "number") setMyScore(data.participant.score);
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
        (p: any) => p.id === client.id || (p.nickname && norm(p.nickname) === norm(nickname))
      );

      // Determine accuracy from server evaluation or matching answer text
      let isCorrect = false;
      if (myEntry && typeof myEntry.isCorrect === "boolean") {
        isCorrect = myEntry.isCorrect;
      } else if (myAnswer) {
        isCorrect = Boolean(data.correctAnswers?.some((c: string) => norm(c) === norm(myAnswer)));
      }

      setWasCorrect(isCorrect);

      // Find my updated score and rank from leaderboard
      if (data.leaderboard) {
        const rankIndex = data.leaderboard.findIndex(
          (p: any) => p.id === client.id || (p.nickname && norm(p.nickname) === norm(nickname))
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
        const norm = (str: any) => String(str ?? "").trim().toLowerCase();
        const rankIndex = data.leaderboard.findIndex(
          (p: any) => p.id === client.id || (p.nickname && norm(p.nickname) === norm(nickname))
        );
        if (rankIndex !== -1) {
          setMyRank(rankIndex + 1);
          setMyScore(data.leaderboard[rankIndex].score);
        }
      }
      setPlayerState("finished");
    });

    setSocket(client);
    };
    connect().catch((error) => {
      if (active) setRoomTitle(error instanceof Error ? error.message : "Could not join this room.");
    });

    return () => {
      active = false;
      s?.disconnect();
    };
  }, [pin, nickname]);

  useEffect(() => {
    if (playerState !== "question" || !currentQuestion?.deadline) return;
    const update = () => setTimeRemaining(Math.max(0, Math.ceil((currentQuestion.deadline - Date.now()) / 1000)));
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
    <div className="max-w-xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase font-bold text-slate-400">PIN</span>
          <span className="font-mono font-bold text-xl text-indigo-600">{pin}</span>
          <span className="font-semibold text-slate-700 text-sm hidden sm:inline">
            • {roomTitle}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full">
            {nickname}
          </span>
          <div className="flex items-center gap-1 font-bold text-emerald-600 text-sm">
            <Trophy className="w-4 h-4" />
            <span>{myScore}</span>
          </div>
        </div>
      </div>

      {/* State: Lobby */}
      {playerState === "lobby" && (
        <div className="bg-white p-10 rounded-3xl shadow-sm border border-slate-200 text-center space-y-6">
          <div className="inline-flex p-4 bg-indigo-50 rounded-full text-indigo-600 animate-pulse">
            <Users className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800">You're In, {nickname}!</h1>
            <p className="text-slate-500 mt-2 text-sm">
              See your name on the host's screen?
            </p>
          </div>
          <div className="py-4 px-6 bg-slate-50 rounded-2xl border border-slate-200 inline-block text-slate-600 font-medium text-sm">
            Waiting for the host to start the quiz...
          </div>
        </div>
      )}

      {/* State: Active Question */}
      {playerState === "question" && currentQuestion && (
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-md border border-slate-200 space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-md">
              Question {currentQuestion.index + 1} of {currentQuestion.total}
            </span>
            <div className="flex items-center gap-1.5 text-rose-600 font-mono font-bold text-base bg-rose-50 px-3 py-1 rounded-md">
              <Clock className="w-4 h-4" />
              <span>{timeRemaining}s</span>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 leading-snug">
            {currentQuestion.text}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {currentQuestion.options.map((opt: string, i: number) => {
              const bgColors = [
                "bg-red-500 hover:bg-red-600 active:scale-95 text-white",
                "bg-blue-500 hover:bg-blue-600 active:scale-95 text-white",
                "bg-amber-500 hover:bg-amber-600 active:scale-95 text-white",
                "bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white",
              ];
              const shapes = ["▲", "◆", "●", "■"];

              return (
                <button
                  key={i}
                  onClick={() => handleSubmit(opt)}
                  className={`p-6 rounded-2xl font-bold text-lg text-left transition transform flex items-center gap-3 shadow-sm ${bgColors[i % 4]}`}
                >
                  <span className="text-xl opacity-75">{shapes[i % 4]}</span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* State: Answer Submitted, Waiting */}
      {playerState === "submitted" && (
        <div className="bg-white p-10 rounded-3xl shadow-sm border border-slate-200 text-center space-y-6">
          <div className="inline-flex p-4 bg-indigo-50 rounded-full text-indigo-600 animate-bounce">
            <Sparkles className="w-10 h-10" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800">Answer Locked In!</h2>
            <p className="text-slate-500 mt-2 text-sm">
              You chose: <span className="font-bold text-slate-800">"{selectedAnswer}"</span>
            </p>
          </div>
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-slate-600 text-sm">
            Waiting for other players or timer to finish...
          </div>
        </div>
      )}

      {/* State: Round Results */}
      {playerState === "results" && (
        <div
          className={`p-8 rounded-3xl shadow-md border text-center space-y-6 transition ${
            wasCorrect
              ? "bg-white border-emerald-300 ring-2 ring-emerald-500/20"
              : "bg-white border-slate-200"
          }`}
        >
          <div className="inline-flex p-4 rounded-full">
            {wasCorrect ? (
              <div className="p-3 bg-emerald-100 text-emerald-600 rounded-full animate-bounce">
                <CheckCircle2 className="w-16 h-16" />
              </div>
            ) : (
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full animate-pulse">
                <XCircle className="w-16 h-16" />
              </div>
            )}
          </div>

          <div>
            <h2
              className={`text-3xl font-black ${
                wasCorrect ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {wasCorrect ? "Correct! 🎉" : "Incorrect"}
            </h2>

            {selectedAnswer && (
              <p className="text-slate-600 mt-2 text-sm">
                You chose:{" "}
                <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                  {selectedAnswer}
                </span>
              </p>
            )}

            <p className="text-slate-500 mt-1 text-sm">
              Correct Answer:{" "}
              <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                {roundResult?.correctAnswers?.join(", ")}
              </span>
            </p>
          </div>

          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 flex justify-around">
            <div>
              <p className="text-xs uppercase font-bold text-slate-400">Total Score</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{myScore} pts</p>
            </div>
            <div>
              <p className="text-xs uppercase font-bold text-slate-400">Current Rank</p>
              <p className="text-2xl font-black text-indigo-600 mt-1">#{myRank}</p>
            </div>
          </div>

          <p className="text-xs text-slate-400 animate-pulse">
            Next question coming up shortly...
          </p>
        </div>
      )}

      {/* State: Finished */}
      {playerState === "finished" && (
        <div className="bg-white p-10 rounded-3xl shadow-lg border border-slate-200 text-center space-y-6">
          <div className="inline-flex p-5 bg-amber-50 rounded-full text-amber-500">
            <Trophy className="w-14 h-14" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900">Quiz Completed!</h1>
            <p className="text-slate-500 mt-1">Great game, {nickname}!</p>
          </div>

          <div className="p-6 bg-indigo-50 rounded-2xl border border-indigo-200">
            <p className="text-xs uppercase font-bold text-indigo-600">Your Final Standing</p>
            <p className="text-5xl font-black text-indigo-700 mt-2">#{myRank}</p>
            <p className="text-slate-600 font-semibold mt-1">{myScore} points</p>
          </div>

          <a
            href="/"
            className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl"
          >
            Play Another Quiz
          </a>
        </div>
      )}

      <div className="text-center text-xs text-slate-400">
        Status:{" "}
        <span className={connected ? "text-emerald-500 font-semibold" : "text-amber-500 font-semibold"}>
          {connected ? "Connected Live" : "Connecting..."}
        </span>
      </div>
    </div>
  );
}

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-xl mx-auto p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
          Loading quiz room...
        </div>
      }
    >
      <RoomContent />
    </Suspense>
  );
}
