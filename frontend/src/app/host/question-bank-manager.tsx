"use client";

import { useState, useEffect, useMemo, type ChangeEvent, type FormEvent } from "react";
import {
  Folder,
  FolderPlus,
  Plus,
  Copy,
  Trash2,
  Edit3,
  Search,
  Upload,
  Download,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  X,
  FileCode,
  Sparkles,
  Clock,
  Check,
  ChevronDown,
  ChevronRight,
  MoveRight,
  Layers,
  HelpCircle,
  FileJson,
} from "lucide-react";
import {
  MAX_QUESTION_OPTIONS,
  QUESTION_TIMER_PRESETS,
  type QuestionFormValue,
  createQuestionFormValue,
  selectCorrectQuestionOption,
  removeQuestionOption,
  addQuestionOption,
  buildQuestionData,
} from "./question-editor-utils";
import { toggleBankQuestionSelection } from "./question-picker-utils";

type Bank = {
  id: string;
  name: string;
  description?: string;
  questionCount: number;
};

type BankQuestion = {
  id: string;
  questionData: Record<string, unknown>;
};

type Props = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  mode: "manage" | "select";
  onClose: () => void;
  onImport?: (questions: Array<Record<string, unknown>>) => void;
  maxSelection?: number;
};

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function questionLabel(question: Record<string, unknown>) {
  return String(question.question ?? question.text ?? "Untitled Question");
}

const OPTION_THEMES = [
  { bg: "bg-[#EF4444]", text: "text-red-700", border: "border-red-200", light: "bg-red-50", shape: "▲", label: "A" },
  { bg: "bg-[#3B82F6]", text: "text-blue-700", border: "border-blue-200", light: "bg-blue-50", shape: "◆", label: "B" },
  { bg: "bg-[#F59E0B]", text: "text-amber-700", border: "border-amber-200", light: "bg-amber-50", shape: "●", label: "C" },
  { bg: "bg-[#10B981]", text: "text-emerald-700", border: "border-emerald-200", light: "bg-emerald-50", shape: "■", label: "D" },
];

export default function QuestionBankManager({
  apiFetch,
  mode,
  onClose,
  onImport,
  maxSelection = 50,
}: Props) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankLoading, setBankLoading] = useState(true);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bankSearch, setBankSearch] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [activeBank, setActiveBank] = useState<Bank | null>(null);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [bankForm, setBankForm] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [questionForm, setQuestionForm] = useState<{ id?: string; value: QuestionFormValue } | null>(null);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [destinationBankId, setDestinationBankId] = useState("");
  const [openPickerBanks, setOpenPickerBanks] = useState<string[]>([]);
  const [pickerQuestions, setPickerQuestions] = useState<Record<string, BankQuestion[]>>({});
  const [pickerSelection, setPickerSelection] = useState<Record<string, Record<string, unknown>>>({});
  const [previewQuestion, setPreviewQuestion] = useState<Record<string, unknown> | null>(null);

  const refreshBanks = async () => {
    setBankLoading(true);
    try {
      const rows = await readResponse<Bank[]>(await apiFetch("/api/question-banks"));
      setBanks(rows);
      setActiveBank((current) => (current ? rows.find((bank) => bank.id === current.id) || null : null));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load question banks.");
    } finally {
      setBankLoading(false);
    }
  };

  useEffect(() => {
    void refreshBanks();
  }, []);

  const loadBankQuestions = async (bank: Bank) => {
    setActiveBank(bank);
    setQuestionLoading(true);
    setQuestionSearch("");
    setSelectedQuestionIds([]);
    try {
      setQuestions(await readResponse<BankQuestion[]>(await apiFetch(`/api/question-banks/${bank.id}/questions`)));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load bank questions.");
      setQuestions([]);
    } finally {
      setQuestionLoading(false);
    }
  };

  const saveBank = async (event: FormEvent) => {
    event.preventDefault();
    if (!bankForm) return;
    try {
      const path = bankForm.id ? `/api/question-banks/${bankForm.id}` : "/api/question-banks";
      const method = bankForm.id ? "PATCH" : "POST";
      await readResponse(
        await apiFetch(path, {
          method,
          body: JSON.stringify({ name: bankForm.name, description: bankForm.description }),
        })
      );
      setNotice(bankForm.id ? "Question bank updated." : "Question bank created.");
      setBankForm(null);
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this bank.");
    }
  };

  const duplicateBank = async (bank: Bank) => {
    try {
      const result = await readResponse<Bank>(
        await apiFetch(`/api/question-banks/${bank.id}/duplicate`, { method: "POST" })
      );
      setNotice(`Created “${result.name}”.`);
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not duplicate this bank.");
    }
  };

  const deleteBank = async (bank: Bank) => {
    if (!window.confirm(`Delete “${bank.name}” and all ${bank.questionCount} saved questions? This cannot be undone.`))
      return;
    try {
      await readResponse(await apiFetch(`/api/question-banks/${bank.id}`, { method: "DELETE" }));
      if (activeBank?.id === bank.id) {
        setActiveBank(null);
        setQuestions([]);
      }
      setNotice("Question bank deleted.");
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this bank.");
    }
  };

  const saveQuestion = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeBank || !questionForm) return;
    try {
      const result = buildQuestionData(questionForm.value);
      if (!result.questionData) throw new Error(result.error || "Check the question details and try again.");
      const path = questionForm.id
        ? `/api/question-banks/${activeBank.id}/questions/${questionForm.id}`
        : `/api/question-banks/${activeBank.id}/questions`;
      const saved = await readResponse<BankQuestion>(
        await apiFetch(path, {
          method: questionForm.id ? "PATCH" : "POST",
          body: JSON.stringify({ questionData: result.questionData }),
        })
      );
      setQuestions((current) =>
        questionForm.id ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved]
      );
      setQuestionForm(null);
      setNotice(questionForm.id ? "Question updated." : "Question added.");
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this question.");
    }
  };

  const editQuestion = (item: BankQuestion) => {
    const data = item.questionData;
    const metadata = Object.fromEntries(
      Object.entries(data).filter(
        ([key]) => !["question", "text", "options", "correct", "timeLimit", "explanation"].includes(key)
      )
    );
    setQuestionForm({
      id: item.id,
      value: {
        question: questionLabel(data),
        options: Array.isArray(data.options) ? data.options.map(String) : ["", ""],
        correctOptionIndex: Array.isArray(data.options)
          ? data.options.findIndex(
              (option) =>
                String(option).toLocaleLowerCase("en") === String(data.correct || "").toLocaleLowerCase("en")
            )
          : null,
        timeLimit: String(data.timeLimit || 20),
        explanation: typeof data.explanation === "string" ? data.explanation : "",
        metadata: JSON.stringify(metadata, null, 2),
      },
    });
  };

  const duplicateQuestion = async (item: BankQuestion) => {
    if (!activeBank) return;
    try {
      const duplicate = await readResponse<BankQuestion>(
        await apiFetch(`/api/question-banks/${activeBank.id}/questions/${item.id}/duplicate`, { method: "POST" })
      );
      setQuestions((current) => [...current, duplicate]);
      setNotice("Question duplicated.");
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not duplicate this question.");
    }
  };

  const deleteQuestion = async (item: BankQuestion) => {
    if (!activeBank || !window.confirm("Delete this saved question?")) return;
    try {
      await readResponse(
        await apiFetch(`/api/question-banks/${activeBank.id}/questions/${item.id}`, { method: "DELETE" })
      );
      setQuestions((current) => current.filter((question) => question.id !== item.id));
      setSelectedQuestionIds((current) => current.filter((id) => id !== item.id));
      setNotice("Question deleted.");
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this question.");
    }
  };

  const transferQuestions = async (mode: "copy" | "move") => {
    if (!activeBank || !destinationBankId || !selectedQuestionIds.length) return;
    try {
      const result = await readResponse<{ transferred: number }>(
        await apiFetch(`/api/question-banks/${activeBank.id}/transfer`, {
          method: "POST",
          body: JSON.stringify({ targetBankId: destinationBankId, mode, questionIds: selectedQuestionIds }),
        })
      );
      setNotice(
        `${result.transferred} question${result.transferred === 1 ? "" : "s"} ${
          mode === "copy" ? "copied" : "moved"
        }.`
      );
      setSelectedQuestionIds([]);
      const target = banks.find((bank) => bank.id === destinationBankId);
      if (mode === "move") await loadBankQuestions(activeBank);
      if (target) await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not transfer the selected questions.");
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeBank) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed.questions;
      if (!Array.isArray(imported)) throw new Error("The JSON file must contain a question array.");
      const result = await readResponse<{ imported: number; questions: BankQuestion[] }>(
        await apiFetch(`/api/question-banks/${activeBank.id}/import`, {
          method: "POST",
          body: JSON.stringify({ questions: imported }),
        })
      );
      setQuestions((current) => [...current, ...result.questions]);
      setNotice(`${result.imported} question${result.imported === 1 ? "" : "s"} imported successfully.`);
      setShowJsonModal(false);
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import this JSON file.");
    } finally {
      event.target.value = "";
    }
  };

  const exportBank = () => {
    if (!activeBank) return;
    const json = JSON.stringify(
      {
        format: "quiz-platform-question-bank",
        version: 1,
        bank: { name: activeBank.name, description: activeBank.description },
        questions: questions.map((item) => item.questionData),
      },
      null,
      2
    );
    const objectUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${
      activeBank.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "question-bank"
    }.json`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  const togglePickerBank = async (bank: Bank) => {
    if (openPickerBanks.includes(bank.id)) {
      setOpenPickerBanks((current) => current.filter((id) => id !== bank.id));
      return;
    }
    setOpenPickerBanks((current) => [...current, bank.id]);
    if (pickerQuestions[bank.id]) return;
    try {
      const rows = await readResponse<BankQuestion[]>(await apiFetch(`/api/question-banks/${bank.id}/questions`));
      setPickerQuestions((current) => ({ ...current, [bank.id]: rows }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load questions.");
    }
  };

  const selectAllBankQuestions = async (bank: Bank) => {
    let rows = pickerQuestions[bank.id];
    if (!rows) {
      try {
        rows = await readResponse<BankQuestion[]>(await apiFetch(`/api/question-banks/${bank.id}/questions`));
        setPickerQuestions((current) => ({ ...current, [bank.id]: rows || [] }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load questions.");
        return;
      }
    }
    const result = toggleBankQuestionSelection(pickerSelection, rows, maxSelection);
    setPickerSelection(result.selection);
    setError(
      result.overflow > 0
        ? `Selected as many as fit. Your quiz has room for up to ${maxSelection} more questions.`
        : ""
    );
  };

  const togglePickerQuestion = (item: BankQuestion) => {
    setPickerSelection((current) => {
      if (current[item.id]) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      if (Object.keys(current).length >= maxSelection) return current;
      return { ...current, [item.id]: item.questionData };
    });
  };

  const pickerEntries = Object.entries(pickerSelection);
  const filteredBanks = useMemo(
    () => banks.filter((bank) => bank.name.toLowerCase().includes(bankSearch.trim().toLowerCase())),
    [banks, bankSearch]
  );
  const filteredQuestions = useMemo(
    () =>
      questions.filter((item) =>
        questionLabel(item.questionData).toLowerCase().includes(questionSearch.trim().toLowerCase())
      ),
    [questions, questionSearch]
  );

  const openEditor = (item?: BankQuestion) => {
    if (item) editQuestion(item);
    else setQuestionForm({ value: createQuestionFormValue() });
    setError("");
  };

  // ----------------- SELECT / PICKER MODAL (MODE === "select") -----------------
  if (mode === "select") {
    return (
      <div
        className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bank-picker-title"
      >
        <div className="w-full max-w-4xl rounded-3xl bg-white p-6 sm:p-8 shadow-modal border border-surface-border my-auto max-h-[90vh] flex flex-col">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-surface-border">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-bold uppercase tracking-wider mb-2 border border-brand-200/60">
                <Layers className="w-3.5 h-3.5 text-brand-600" />
                <span>Question Bank Vault</span>
              </div>
              <h2 id="bank-picker-title" className="font-display font-extrabold text-2xl text-slate-900">
                Add Questions to Quiz
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Pick questions from your private banks to copy into this live quiz session.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700 flex items-center gap-2">
              <span className="font-bold">!</span>
              <span>{error}</span>
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={bankSearch}
                onChange={(event) => setBankSearch(event.target.value)}
                placeholder="Filter question banks by name..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-700 font-display text-xs font-bold shrink-0">
              <span className="text-brand-600">{pickerEntries.length}</span> / {maxSelection} Selected
            </div>
          </div>

          <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1 min-h-[250px] max-h-[46vh]">
            {bankLoading ? (
              <div className="py-12 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <span>Loading question banks...</span>
              </div>
            ) : filteredBanks.length === 0 ? (
              <div className="py-12 text-center border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-sm">
                No question banks match this search.
              </div>
            ) : (
              filteredBanks.map((bank) => {
                const isOpen = openPickerBanks.includes(bank.id);
                const bankQuestions = pickerQuestions[bank.id] || [];
                const allBankQuestionsSelected =
                  bankQuestions.length > 0 && bankQuestions.every((item) => pickerSelection[item.id]);

                return (
                  <div
                    key={bank.id}
                    className="overflow-hidden rounded-2xl border border-surface-border transition-all"
                  >
                    <div className="flex items-center gap-3 bg-slate-50/80 px-4 py-3 hover:bg-slate-100/70 transition">
                      <button
                        type="button"
                        onClick={() => void togglePickerBank(bank)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4 text-brand-600 shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <Folder className="w-4 h-4 text-brand-500 shrink-0" />
                        <span className="truncate font-display font-bold text-slate-900 text-sm">
                          {bank.name}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-600 font-semibold shrink-0">
                          {bank.questionCount}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={bank.questionCount === 0}
                        onClick={() => void selectAllBankQuestions(bank)}
                        className="px-2.5 py-1 text-xs font-bold text-brand-600 hover:bg-brand-50 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      >
                        {allBankQuestionsSelected ? "Deselect all" : "Select all"}
                      </button>
                    </div>

                    {isOpen && (
                      <div className="divide-y divide-slate-100 bg-white">
                        {!pickerQuestions[bank.id] ? (
                          <p className="p-4 text-xs text-slate-400 text-center animate-pulse">
                            Loading questions...
                          </p>
                        ) : pickerQuestions[bank.id].length === 0 ? (
                          <p className="p-4 text-xs text-slate-400 text-center">This bank has no questions.</p>
                        ) : (
                          pickerQuestions[bank.id].map((item) => {
                            const checked = Boolean(pickerSelection[item.id]);
                            return (
                              <div
                                key={item.id}
                                className={`flex items-start gap-3 p-3.5 hover:bg-slate-50/70 transition ${
                                  checked ? "bg-brand-50/40" : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!checked && pickerEntries.length >= maxSelection}
                                  onChange={() => togglePickerQuestion(item)}
                                  className="mt-1 h-4 w-4 rounded text-brand-600 focus:ring-brand-500/20 accent-brand-600"
                                />
                                <button
                                  type="button"
                                  onClick={() => setPreviewQuestion(item.questionData)}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <span className="block font-semibold text-slate-800 text-sm">
                                    {questionLabel(item.questionData)}
                                  </span>
                                  <span className="mt-1 block truncate text-xs text-slate-400">
                                    {Array.isArray(item.questionData.options)
                                      ? item.questionData.options.join(" • ")
                                      : ""}
                                  </span>
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Preview Panel if a question is clicked */}
          {previewQuestion && (
            <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50/70 p-4 animate-fade-in shrink-0">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display font-bold text-slate-900 text-sm">
                  {questionLabel(previewQuestion)}
                </h3>
                <button
                  type="button"
                  onClick={() => setPreviewQuestion(null)}
                  className="text-xs font-bold text-brand-600 hover:text-brand-800"
                >
                  Close
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Timer: <strong className="font-mono">{String(previewQuestion.timeLimit || 20)}s</strong>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {Array.isArray(previewQuestion.options) &&
                  previewQuestion.options.map((opt, i) => {
                    const isCorrect = String(opt) === String(previewQuestion.correct);
                    return (
                      <div
                        key={i}
                        className={`p-2 rounded-xl border flex items-center justify-between ${
                          isCorrect
                            ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-bold"
                            : "bg-white border-slate-200 text-slate-600"
                        }`}
                      >
                        <span>{String(opt)}</span>
                        {isCorrect && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-surface-border flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pickerEntries.length === 0}
              onClick={() => onImport?.(pickerEntries.map(([, val]) => val))}
              className="tactile-press px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-display font-bold text-sm shadow-tactile-brand transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add {pickerEntries.length || "0"} Questions to Quiz</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- MANAGE VIEW (FULL QUESTION BANK & VAULT) -----------------
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header matching quizplatform_question_bank_json_vault/code.html */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200/60 text-brand-700 text-xs font-bold uppercase tracking-wider mb-2">
            <Layers className="w-3.5 h-3.5 text-brand-600" />
            <span>Question Bank & JSON Vault</span>
          </div>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
            Question Bank Vault
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Curate, organize, and inspect your modular trivia vault with JSON ingestion and schema support.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Back to Quiz Creator
          </button>
          <button
            type="button"
            onClick={() => setBankForm({ name: "", description: "" })}
            className="tactile-press inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-display font-bold text-xs sm:text-sm shadow-tactile-brand transition"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Create Bank</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2.5 animate-shake">
          <span className="font-bold">!</span>
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div role="status" className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      {/* When no specific bank is opened -> Show Bank Folders Grid */}
      {!activeBank ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                aria-label="Search question banks"
                value={bankSearch}
                onChange={(event) => setBankSearch(event.target.value)}
                placeholder="Search banks by name..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-surface-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <span className="text-xs text-slate-400 font-semibold hidden sm:inline">
              {banks.length} bank{banks.length === 1 ? "" : "s"} total
            </span>
          </div>

          {bankLoading ? (
            <div className="py-16 text-center text-sm text-slate-400 flex flex-col items-center gap-3">
              <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <span>Loading your private trivia banks...</span>
            </div>
          ) : filteredBanks.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-slate-200 p-12 text-center bg-white space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 mx-auto flex items-center justify-center">
                <Folder className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-display font-bold text-slate-800 text-lg">
                  {banks.length ? "No matching banks" : "Your Vault is Empty"}
                </h3>
                <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                  Create a question bank to organize your trivia questions into reusable collections.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBankForm({ name: "", description: "" })}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-500 text-white font-display font-bold text-sm shadow-tactile-brand transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Bank</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBanks.map((bank) => (
                <div
                  key={bank.id}
                  className="bg-white rounded-2xl border border-surface-border p-5 shadow-card hover:shadow-elevated hover:border-brand-300 transition-all flex flex-col justify-between group"
                >
                  <button
                    type="button"
                    onClick={() => void loadBankQuestions(bank)}
                    className="block w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 group-hover:scale-105 transition-transform">
                        <Folder className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                        {bank.questionCount} Qs
                      </span>
                    </div>

                    <h3 className="font-display font-bold text-lg text-slate-900 group-hover:text-brand-600 transition-colors">
                      {bank.name}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2 min-h-[32px]">
                      {bank.description || "No description provided."}
                    </p>
                  </button>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => void loadBankQuestions(bank)}
                      className="text-brand-600 hover:text-brand-700 flex items-center gap-1"
                    >
                      <span>Open Bank</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setBankForm({ id: bank.id, name: bank.name, description: bank.description || "" })
                        }
                        className="text-slate-500 hover:text-slate-800 p-1 hover:bg-slate-100 rounded"
                        title="Edit Bank"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void duplicateBank(bank)}
                        className="text-slate-500 hover:text-slate-800 p-1 hover:bg-slate-100 rounded"
                        title="Duplicate Bank"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteBank(bank)}
                        className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded"
                        title="Delete Bank"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Inside Active Bank -> Show Questions Table & Actions */
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-surface-border p-6 shadow-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-surface-border">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveBank(null);
                    setQuestions([]);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 mb-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>All Question Banks</span>
                </button>
                <h2 className="font-display font-extrabold text-2xl text-slate-900 flex items-center gap-2">
                  <span>{activeBank.name}</span>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                    {questions.length} Questions
                  </span>
                </h2>
                {activeBank.description && (
                  <p className="mt-1 text-sm text-slate-500">{activeBank.description}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={exportBank}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowJsonModal(true)}
                  className="px-3.5 py-2 rounded-xl border border-brand-200 bg-brand-50 text-xs font-bold text-brand-700 hover:bg-brand-100 flex items-center gap-1.5 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => openEditor()}
                  className="tactile-press px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-display font-bold text-xs shadow-tactile-brand flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Question</span>
                </button>
              </div>
            </div>

            {questionLoading ? (
              <div className="py-12 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <span>Loading questions...</span>
              </div>
            ) : questions.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl space-y-3">
                <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 mx-auto flex items-center justify-center">
                  <FileJson className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-display font-bold text-slate-800">Bank is currently empty</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Add a question manually or import an existing JSON quiz file.
                  </p>
                </div>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowJsonModal(true)}
                    className="px-3 py-1.5 rounded-lg border border-brand-200 bg-brand-50 text-xs font-bold text-brand-700"
                  >
                    Upload JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor()}
                    className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-bold"
                  >
                    Add Question
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      aria-label="Search questions"
                      value={questionSearch}
                      onChange={(event) => setQuestionSearch(event.target.value)}
                      placeholder="Search questions in this bank..."
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                  <span className="text-xs text-slate-400 font-semibold self-end sm:self-center">
                    Showing {filteredQuestions.length} of {questions.length} questions
                  </span>
                </div>

                <div className="space-y-3">
                  {filteredQuestions.map((item) => {
                    const isSelected = selectedQuestionIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`p-4 rounded-2xl border transition-all ${
                          isSelected
                            ? "bg-brand-50/40 border-brand-300"
                            : "bg-slate-50/60 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() =>
                              setSelectedQuestionIds((current) =>
                                current.includes(item.id)
                                  ? current.filter((id) => id !== item.id)
                                  : [...current, item.id]
                              )
                            }
                            className="mt-1 h-4 w-4 rounded text-brand-600 focus:ring-brand-500/20 accent-brand-600 shrink-0"
                          />

                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-display font-bold text-slate-900 text-sm sm:text-base">
                                {questionLabel(item.questionData)}
                              </h4>
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                                {String(item.questionData.timeLimit || 20)}s
                              </span>
                            </div>

                            {/* Option pills with correct option highlighted */}
                            <div className="flex flex-wrap gap-1.5">
                              {Array.isArray(item.questionData.options) &&
                                item.questionData.options.map((opt, oIdx) => {
                                  const isCorrect =
                                    String(opt).toLowerCase() ===
                                    String(item.questionData.correct || "").toLowerCase();
                                  return (
                                    <span
                                      key={oIdx}
                                      className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 font-medium ${
                                        isCorrect
                                          ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-bold"
                                          : "bg-white border-slate-200 text-slate-600"
                                      }`}
                                    >
                                      <span>{OPTION_THEMES[oIdx % 4]?.shape}</span>
                                      <span>{String(opt)}</span>
                                      {isCorrect && <Check className="w-3 h-3 text-emerald-600" />}
                                    </span>
                                  );
                                })}
                            </div>

                            {typeof item.questionData.explanation === "string" && (
                              <p className="text-xs text-slate-500 bg-white/70 p-2 rounded-lg border border-slate-200/60">
                                💡 {item.questionData.explanation}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditor(item)}
                              className="p-1.5 text-slate-500 hover:text-brand-600 hover:bg-slate-100 rounded-lg transition"
                              title="Edit Question"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void duplicateQuestion(item)}
                              className="p-1.5 text-slate-500 hover:text-brand-600 hover:bg-slate-100 rounded-lg transition"
                              title="Duplicate Question"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteQuestion(item)}
                              className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition"
                              title="Delete Question"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Bulk Transfer Action Bar */}
                {selectedQuestionIds.length > 0 && (
                  <div className="p-4 bg-brand-50 border border-brand-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-fade-in">
                    <span className="text-xs sm:text-sm font-bold text-brand-800">
                      {selectedQuestionIds.length} question{selectedQuestionIds.length === 1 ? "" : "s"} selected
                    </span>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <select
                        aria-label="Destination bank"
                        value={destinationBankId}
                        onChange={(event) => setDestinationBankId(event.target.value)}
                        className="text-xs sm:text-sm rounded-xl border border-slate-300 bg-white px-3 py-2 flex-1 sm:flex-initial"
                      >
                        <option value="">Transfer to another bank...</option>
                        {banks
                          .filter((b) => b.id !== activeBank.id)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                      </select>

                      <button
                        type="button"
                        disabled={!destinationBankId}
                        onClick={() => void transferQuestions("copy")}
                        className="px-3 py-2 rounded-xl bg-white border border-brand-300 text-brand-700 text-xs font-bold hover:bg-brand-50 disabled:opacity-40 transition"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        disabled={!destinationBankId}
                        onClick={() => void transferQuestions("move")}
                        className="px-3 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 disabled:opacity-40 transition"
                      >
                        Move
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* JSON Import Modal matching quizplatform_question_import_json_upload_modal/code.html */}
      {showJsonModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 flex items-center justify-center animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-modal border border-surface-border space-y-5">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-surface-border">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <FileCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-lg text-slate-900">
                    Import Questions via JSON
                  </h3>
                  <p className="text-xs text-slate-500">Schema Ingestion & Batch Loader</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowJsonModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-slate-700">
                <HelpCircle className="w-4 h-4 text-brand-500" />
                <span>Supported Format (Array or Object):</span>
              </div>
              <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[11px] font-mono leading-relaxed">
{`[
  {
    "question": "What is Cloudflare DO?",
    "options": ["KV", "Durable Objects", "D1", "R2"],
    "correct": "Durable Objects",
    "timeLimit": 20
  }
]`}
              </pre>
            </div>

            <label className="block border-2 border-dashed border-brand-300 hover:border-brand-500 rounded-2xl p-6 text-center cursor-pointer bg-brand-50/20 hover:bg-brand-50/40 transition">
              <Upload className="w-8 h-8 text-brand-500 mx-auto mb-2" />
              <span className="font-display font-bold text-sm text-slate-800 block">
                Click to browse or drop .json file here
              </span>
              <span className="text-xs text-slate-400 mt-1 block">
                Max 50 questions per batch
              </span>
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void importFile(event)}
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowJsonModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bank Create/Edit Modal matching folder organizer */}
      {bankForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(event) => void saveBank(event)}
            className="w-full max-w-md space-y-5 rounded-3xl bg-white p-6 sm:p-8 shadow-modal border border-surface-border"
          >
            <div className="flex items-center gap-2.5 pb-2 border-b border-surface-border">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                <FolderPlus className="w-4 h-4" />
              </div>
              <h3 className="font-display font-extrabold text-lg text-slate-900">
                {bankForm.id ? "Edit Question Bank" : "Create New Bank"}
              </h3>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Bank Name
              </label>
              <input
                required
                maxLength={80}
                value={bankForm.name}
                onChange={(event) => setBankForm({ ...bankForm, name: event.target.value })}
                placeholder="e.g. Cybersecurity Fundamentals, Web Tech"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Description (Optional)
              </label>
              <textarea
                maxLength={500}
                rows={3}
                value={bankForm.description}
                onChange={(event) => setBankForm({ ...bankForm, description: event.target.value })}
                placeholder="Topic notes, tags, or question bank details..."
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBankForm(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="tactile-press px-5 py-2 rounded-xl bg-brand-500 text-white font-display font-bold text-xs shadow-tactile-brand"
              >
                Save Bank
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Question Form Modal (Add / Edit Question in Bank) */}
      {questionForm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(event) => void saveQuestion(event)}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 sm:p-8 shadow-modal border border-surface-border space-y-5 my-auto"
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-surface-border">
              <div>
                <h3 className="font-display font-extrabold text-xl text-slate-900">
                  {questionForm.id ? "Edit Bank Question" : "Add Bank Question"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click the radio button on an option to designate it as the correct answer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuestionForm(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Question Prompt
              </label>
              <textarea
                autoFocus
                required
                maxLength={500}
                rows={2}
                value={questionForm.value.question}
                onChange={(event) =>
                  setQuestionForm({
                    ...questionForm,
                    value: { ...questionForm.value, question: event.target.value },
                  })
                }
                placeholder="Write your question..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Answer Options
                </span>
                <span className="text-xs font-semibold text-emerald-600">
                  Select one correct answer
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {questionForm.value.options.map((option, index) => {
                  const theme = OPTION_THEMES[index % OPTION_THEMES.length];
                  const correct = questionForm.value.correctOptionIndex === index;
                  return (
                    <div
                      key={index}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border-2 transition-all ${
                        correct
                          ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/20"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setQuestionForm({
                            ...questionForm,
                            value: selectCorrectQuestionOption(questionForm.value, index),
                          })
                        }
                        className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-transform ${
                          correct ? "bg-emerald-600 text-white" : `${theme.bg} text-white opacity-80 hover:opacity-100`
                        }`}
                        title="Click to mark as correct answer"
                      >
                        {correct ? <Check className="w-4 h-4" /> : theme.label}
                      </button>

                      <input
                        type="text"
                        maxLength={200}
                        value={option}
                        onChange={(event) =>
                          setQuestionForm({
                            ...questionForm,
                            value: {
                              ...questionForm.value,
                              options: questionForm.value.options.map((val, oIdx) =>
                                oIdx === index ? event.target.value : val
                              ),
                            },
                          })
                        }
                        placeholder={`Option ${theme.label}`}
                        className="w-full bg-transparent border-0 text-xs sm:text-sm font-medium text-slate-900 focus:outline-none px-1"
                      />

                      {questionForm.value.options.length > 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = removeQuestionOption(
                              questionForm.value.options,
                              questionForm.value.correctOptionIndex,
                              index
                            );
                            setQuestionForm({ ...questionForm, value: { ...questionForm.value, ...next } });
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {questionForm.value.options.length < MAX_QUESTION_OPTIONS && (
                <button
                  type="button"
                  onClick={() =>
                    setQuestionForm({
                      ...questionForm,
                      value: {
                        ...questionForm.value,
                        options: addQuestionOption(questionForm.value.options),
                      },
                    })
                  }
                  className="px-3 py-1.5 rounded-xl border border-dashed border-brand-300 text-brand-600 hover:bg-brand-50 text-xs font-semibold"
                >
                  + Add Answer Option
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Question Timer
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {QUESTION_TIMER_PRESETS.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    onClick={() =>
                      setQuestionForm({
                        ...questionForm,
                        value: { ...questionForm.value, timeLimit: String(seconds) },
                      })
                    }
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      Number(questionForm.value.timeLimit) === seconds
                        ? "bg-brand-500 text-white shadow-xs"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {seconds}s
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Explanation (Optional)
              </label>
              <textarea
                maxLength={4000}
                rows={2}
                value={questionForm.value.explanation}
                onChange={(event) =>
                  setQuestionForm({
                    ...questionForm,
                    value: { ...questionForm.value, explanation: event.target.value },
                  })
                }
                placeholder="Show explanation when answers are revealed..."
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-surface-border">
              <button
                type="button"
                onClick={() => setQuestionForm(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="tactile-press px-6 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-display font-bold text-xs shadow-tactile-brand"
              >
                Save Question
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
