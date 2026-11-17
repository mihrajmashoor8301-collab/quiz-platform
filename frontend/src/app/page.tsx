"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Sparkles, ArrowRight, ShieldCheck, Zap } from "lucide-react";

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
    try {
      const savedNick = localStorage.getItem("quiz_nickname");
      if (savedNick && !nickname) {
        setNickname(savedNick);
      }
    } catch {}
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
      const res = await fetch(`/api/rooms/${cleanPin}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Room not found. Check the PIN and try again.");
      }
      const data = await res.json();
      if (data.status === "finished") {
        throw new Error("This quiz has already finished.");
      }
      localStorage.setItem("quiz_nickname", cleanNick);
      router.push(`/room?pin=${cleanPin}&nickname=${encodeURIComponent(cleanNick)}`);
    } catch (err: any) {
      setError(err.message || "Failed to join room.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto my-8 sm:my-14">
      {/* Decorative Brand Accent Pill */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200/60 shadow-xs">
          <Zap className="w-3.5 h-3.5 text-brand-600 fill-brand-600 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-brand-700">
            Participant Arena
          </span>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-elevated border border-surface-border p-7 sm:p-9 relative overflow-hidden">
        {/* Subtle top glow line */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-brand-600 via-brand-500 to-indigo-400" />

        <div className="text-center mb-8">
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
            Enter Live Arena
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            Enter your 6-digit session PIN and choose a nickname to compete in real-time.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200/80 text-red-700 text-sm flex items-start gap-3 animate-shake">
            <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-red-600">!</span>
            </div>
            <div className="font-medium">{error}</div>
          </div>
        )}

        <form onSubmit={handleJoin} className="space-y-5">
          <div>
            <label
              htmlFor="pin"
              className="block font-display text-xs font-bold uppercase tracking-wider text-slate-700 mb-2"
            >
              Session Game PIN
            </label>
            <div className="relative">
              <input
                id="pin"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000 000"
                className="w-full text-center text-3xl sm:text-4xl font-mono font-black tracking-[0.25em] px-4 py-3.5 bg-slate-50/70 border border-slate-300 rounded-2xl focus:bg-white focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-slate-900 transition-all placeholder:text-slate-300 placeholder:tracking-widest"
                required
                autoFocus={!paramPin}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="nickname"
              className="block font-display text-xs font-bold uppercase tracking-wider text-slate-700 mb-2"
            >
              Your Player Nickname
            </label>
            <input
              id="nickname"
              type="text"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Maverick, Sarah K."
              className="w-full px-4 py-3.5 bg-slate-50/70 border border-slate-300 rounded-2xl focus:bg-white focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 text-base font-semibold text-slate-900 transition-all placeholder:text-slate-400"
              required
              autoFocus={Boolean(paramPin)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 tactile-press bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-display font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-2.5 shadow-tactile-brand transition-all disabled:opacity-50 text-base"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>Join Arena</span>
                <ArrowRight className="w-4 h-4 opacity-75" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5 text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Low-latency edge sync</span>
          </div>
          <a
            href="/host"
            className="font-semibold text-brand-600 hover:text-brand-700 hover:underline transition-colors"
          >
            Host a Quiz →
          </a>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto my-12 p-8 text-center text-slate-400 bg-white rounded-2xl border border-surface-border">
          Loading join screen...
        </div>
      }
    >
      <JoinForm />
    </Suspense>
  );
}
