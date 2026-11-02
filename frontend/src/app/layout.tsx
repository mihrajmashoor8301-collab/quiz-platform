import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Personal Live Quiz Platform",
  description: "A free, self-hosted live quiz platform for personal use",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white shadow-sm">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <a href="/" className="font-bold text-xl text-indigo-600 flex items-center gap-2">
              <span>🎯 QuizPlatform</span>
            </a>
            <nav className="flex gap-4 text-sm font-medium">
              <a href="/" className="text-slate-600 hover:text-indigo-600 transition">
                Join Room
              </a>
              <a href="/host" className="text-slate-600 hover:text-indigo-600 transition">
                Host Dashboard
              </a>
            </nav>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
