"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Users } from "lucide-react";

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramPin = searchParams.get("pin") || "";

  const [pin, setPin] = useState(paramPin);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (paramPin) {
      setPin(paramPin.replace(/\D/g, "").slice(0, 6));
    }
  }, [paramPin]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanPin = pin.trim();
    const cleanNick = nickname.trim();

    if (!cleanPin || !/^\d{6}$/.test(cleanPin)) {
      setError("Please enter a valid 6-digit game PIN.");
      return;
    }
    if (!cleanNick || cleanNick.length < 2) {
      setError("Nickname must be at least 2 characters.");
      return;
    }

    setLoading(true);
    try {
      const backendUrl =
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
      const res = await fetch(`${backendUrl}/rooms/${cleanPin}`);
      if (!res.ok) {
        throw new Error("Room not found. Check the PIN and try again.");
      }
      const data = await res.json();
      if (data.status === "finished") {
        throw new Error("This quiz has already finished.");
      }
      localStorage.setItem("quiz_nickname", cleanNick);
      router.push(`/room/${cleanPin}?nickname=${encodeURIComponent(cleanNick)}`);
    } catch (err: any) {
      setError(err.message || "Failed to join room.");
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12 bg-white rounded-2xl shadow-md border border-slate-200 p-8">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-indigo-100 text-indigo-600 mb-3 shadow-xs">
          <Users className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Join Live Quiz</h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter the 6-digit room PIN from your host to get started.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleJoin} className="space-y-4">
        <div>
          <label htmlFor="pin" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
            Game PIN
          </label>
          <input
            id="pin"
            type="text"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="w-full text-center text-3xl font-mono tracking-widest px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-black text-slate-900"
            required
            autoFocus={!paramPin}
          />
        </div>

        <div>
          <label htmlFor="nickname" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
            Your Nickname
          </label>
          <input
            id="nickname"
            type="text"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Alex"
            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-base font-medium"
            required
            autoFocus={Boolean(paramPin)}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50 text-base"
        >
          <LogIn className="w-5 h-5" />
          <span>{loading ? "Joining..." : "Join Game"}</span>
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-slate-100 text-center">
        <p className="text-sm text-slate-500">
          Want to host your own quiz?{" "}
          <a href="/host" className="text-indigo-600 font-semibold hover:underline">
            Go to Host Dashboard
          </a>
        </p>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading join screen...</div>}>
      <JoinForm />
    </Suspense>
  );
}
