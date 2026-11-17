import type { Metadata } from "next";
import { Zap } from "lucide-react";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "QuizPlatform — Live Interactive Arena & Quiz Studio",
  description: "High-velocity real-time quizzes, collaborative workshops, and executive arena trivia powered by Cloudflare Workers and Durable Objects",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] antialiased flex flex-col selection:bg-brand-100 selection:text-brand-900">
        <header className="sticky top-0 z-40 border-b border-surface-border bg-white/90 backdrop-blur-md shadow-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <a href="/" className="flex items-center gap-2.5 group">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-700 via-brand-600 to-brand-500 text-white flex items-center justify-center shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform duration-150">
                  <Zap className="w-5 h-5 fill-white text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-display font-extrabold text-xl tracking-tight text-slate-900 group-hover:text-brand-600 transition-colors">
                    QuizPlatform
                  </span>
                  <span className="hidden sm:inline-flex text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                    Live Arena
                  </span>
                </div>
              </a>
            </div>

            <nav className="flex items-center gap-2 sm:gap-4">
              <a
                href="/"
                className="text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-lg text-slate-600 hover:text-brand-600 hover:bg-slate-100/70 transition-colors"
              >
                Join Room
              </a>
              <a
                href="/host"
                className="text-xs sm:text-sm font-semibold px-3.5 py-1.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/25 transition-all flex items-center gap-1.5"
              >
                Host Portal
              </a>
            </nav>
          </div>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
