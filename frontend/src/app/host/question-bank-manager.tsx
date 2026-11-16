"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  addQuestionOption,
  buildQuestionData,
  createQuestionFormValue,
  MAX_QUESTION_OPTIONS,
  QuestionFormValue,
  QUESTION_TIMER_PRESETS,
  removeQuestionOption,
  selectCorrectQuestionOption,
} from "./question-editor-utils";
import { toggleBankQuestionSelection } from "./question-picker-utils";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Bank = {
  id: string;
  name: string;
  description: string;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
};
type BankQuestion = {
  id: string;
  bankId: string;
  questionData: Record<string, unknown>;
  position: number;
};

type Props = {
  apiFetch: ApiFetch;
  mode: "manage" | "select";
  onClose: () => void;
  onImport?: (questions: Record<string, unknown>[]) => void;
  maxSelection?: number;
};

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The question bank request failed.");
  return result as T;
}

function questionLabel(question: Record<string, unknown>) {
  return String(question.question ?? question.text ?? "Untitled question");
}

export default function QuestionBankManager({ apiFetch, mode, onClose, onImport, maxSelection = 50 }: Props) {
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
      setActiveBank((current) => current ? rows.find((bank) => bank.id === current.id) || null : null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load question banks.");
    } finally {
      setBankLoading(false);
    }
  };

  useEffect(() => { void refreshBanks(); }, []);

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
      await readResponse(await apiFetch(path, {
        method,
        body: JSON.stringify({ name: bankForm.name, description: bankForm.description }),
      }));
      setNotice(bankForm.id ? "Question bank updated." : "Question bank created.");
      setBankForm(null);
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this bank.");
    }
  };

  const duplicateBank = async (bank: Bank) => {
    try {
      const result = await readResponse<Bank>(await apiFetch(`/api/question-banks/${bank.id}/duplicate`, { method: "POST" }));
      setNotice(`Created “${result.name}”.`);
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not duplicate this bank.");
    }
  };

  const deleteBank = async (bank: Bank) => {
    if (!window.confirm(`Delete “${bank.name}” and all ${bank.questionCount} saved questions? This cannot be undone.`)) return;
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
      const saved = await readResponse<BankQuestion>(await apiFetch(path, {
        method: questionForm.id ? "PATCH" : "POST",
        body: JSON.stringify({ questionData: result.questionData }),
      }));
      setQuestions((current) => questionForm.id
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved]);
      setQuestionForm(null);
      setNotice(questionForm.id ? "Question updated." : "Question added.");
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this question.");
    }
  };

  const editQuestion = (item: BankQuestion) => {
    const data = item.questionData;
    const metadata = Object.fromEntries(Object.entries(data).filter(([key]) =>
      !["question", "text", "options", "correct", "timeLimit", "explanation"].includes(key)
    ));
    setQuestionForm({
      id: item.id,
      value: {
        question: questionLabel(data),
        options: Array.isArray(data.options) ? data.options.map(String) : ["", ""],
        correctOptionIndex: Array.isArray(data.options)
          ? data.options.findIndex((option) => String(option).toLocaleLowerCase("en") === String(data.correct || "").toLocaleLowerCase("en"))
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
      const duplicate = await readResponse<BankQuestion>(await apiFetch(
        `/api/question-banks/${activeBank.id}/questions/${item.id}/duplicate`, { method: "POST" }
      ));
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
      await readResponse(await apiFetch(`/api/question-banks/${activeBank.id}/questions/${item.id}`, { method: "DELETE" }));
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
      const result = await readResponse<{ transferred: number }>(await apiFetch(`/api/question-banks/${activeBank.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({ targetBankId: destinationBankId, mode, questionIds: selectedQuestionIds }),
      }));
      setNotice(`${result.transferred} question${result.transferred === 1 ? "" : "s"} ${mode === "copy" ? "copied" : "moved"}.`);
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
      const result = await readResponse<{ imported: number; questions: BankQuestion[] }>(await apiFetch(
        `/api/question-banks/${activeBank.id}/import`,
        { method: "POST", body: JSON.stringify({ questions: imported }) }
      ));
      setQuestions((current) => [...current, ...result.questions]);
      setNotice(`${result.imported} question${result.imported === 1 ? "" : "s"} imported.`);
      await refreshBanks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import this JSON file.");
    } finally {
      event.target.value = "";
    }
  };

  const exportBank = () => {
    if (!activeBank) return;
    const json = JSON.stringify({
      format: "quiz-platform-question-bank",
      version: 1,
      bank: { name: activeBank.name, description: activeBank.description },
      questions: questions.map((item) => item.questionData),
    }, null, 2);
    const objectUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${activeBank.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "question-bank"}.json`;
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
    setError(result.overflow > 0
      ? `Selected as many as fit. Your quiz has room for up to ${maxSelection} more questions.`
      : "");
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
  const filteredBanks = useMemo(() => banks.filter((bank) =>
    bank.name.toLowerCase().includes(bankSearch.trim().toLowerCase())
  ), [banks, bankSearch]);
  const filteredQuestions = useMemo(() => questions.filter((item) =>
    questionLabel(item.questionData).toLowerCase().includes(questionSearch.trim().toLowerCase())
  ), [questions, questionSearch]);

  const openEditor = (item?: BankQuestion) => {
    if (item) editQuestion(item);
    else setQuestionForm({ value: createQuestionFormValue() });
    setError("");
  };

  if (mode === "select") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-3 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="bank-picker-title">
        <div className="mx-auto max-w-4xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="bank-picker-title" className="text-2xl font-bold text-slate-800">Add from Question Bank</h2>
              <p className="mt-1 text-sm text-slate-500">Choose questions from one or more of your private banks. Imported questions are copied into this quiz.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Close</button>
          </div>
          {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input value={bankSearch} onChange={(event) => setBankSearch(event.target.value)} placeholder="Search banks by name" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2" />
            <span className="self-center text-sm font-semibold text-slate-600">{pickerEntries.length} / {maxSelection} selected</span>
          </div>
          <div className="mt-4 max-h-[42vh] space-y-2 overflow-y-auto">
            {bankLoading ? <p className="py-6 text-center text-sm text-slate-500">Loading your banks…</p> : filteredBanks.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No question banks match this search.</p> : filteredBanks.map((bank) => {
              const isOpen = openPickerBanks.includes(bank.id);
              const bankQuestions = pickerQuestions[bank.id] || [];
              const allBankQuestionsSelected = bankQuestions.length > 0 && bankQuestions.every((item) => pickerSelection[item.id]);
              return <section key={bank.id} className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 sm:px-4">
                  <button type="button" onClick={() => void togglePickerBank(bank)} className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-3 text-left hover:text-indigo-700">
                    <span className="truncate font-semibold text-slate-800">{isOpen ? "▾" : "▸"} {bank.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{bank.questionCount} questions</span>
                  </button>
                  <button type="button" disabled={bank.questionCount === 0} onClick={() => void selectAllBankQuestions(bank)} className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40">
                    {allBankQuestionsSelected ? "Clear all" : "Select all"}
                  </button>
                </div>
                {isOpen && <div className="divide-y divide-slate-100">
                  {!pickerQuestions[bank.id] ? <p className="p-4 text-sm text-slate-500">Loading questions…</p> : pickerQuestions[bank.id].length === 0 ? <p className="p-4 text-sm text-slate-500">This bank is empty.</p> : pickerQuestions[bank.id].map((item) => {
                    const checked = Boolean(pickerSelection[item.id]);
                    return <div key={item.id} className="flex items-start gap-3 p-3 sm:p-4">
                      <input aria-label={`Select ${questionLabel(item.questionData)}`} type="checkbox" checked={checked} disabled={!checked && pickerEntries.length >= maxSelection} onChange={() => togglePickerQuestion(item)} className="mt-1 h-4 w-4 accent-indigo-600" />
                      <button type="button" onClick={() => setPreviewQuestion(item.questionData)} className="min-w-0 flex-1 text-left">
                        <span className="block font-medium text-slate-800">{questionLabel(item.questionData)}</span>
                        <span className="mt-1 block truncate text-xs text-slate-500">{Array.isArray(item.questionData.options) ? item.questionData.options.join(" · ") : ""}</span>
                      </button>
                    </div>;
                  })}
                </div>}
              </section>;
            })}
          </div>
          {previewQuestion && <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-start justify-between gap-3"><h3 className="font-bold text-slate-800">Preview: {questionLabel(previewQuestion)}</h3><button type="button" onClick={() => setPreviewQuestion(null)} className="text-xs font-semibold text-indigo-700">Close</button></div>
            <p className="mt-1 text-xs text-slate-600">Timer: {String(previewQuestion.timeLimit || 20)} seconds</p>
            <ul className="mt-2 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">{Array.isArray(previewQuestion.options) && previewQuestion.options.map((option, index) => <li key={index}>{String(option)}{String(option) === String(previewQuestion.correct) ? " ✓" : ""}</li>)}</ul>
            {typeof previewQuestion.explanation === "string" && <p className="mt-2 text-sm text-slate-600">{previewQuestion.explanation}</p>}
          </div>}
          <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
            <button type="button" disabled={pickerEntries.length === 0} onClick={() => onImport?.(pickerEntries.map(([, value]) => value))} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">Add {pickerEntries.length || "selected"} to quiz</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Question Bank</h2>
          <p className="mt-1 text-sm text-slate-500">Private to your host account. Save, organize, import, and reuse questions across quizzes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Back to quiz creator</button>
          <button type="button" onClick={() => setBankForm({ name: "", description: "" })} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Create bank</button>
        </div>
      </div>
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
      {!activeBank ? <div className="mt-5">
        <input aria-label="Search question banks" value={bankSearch} onChange={(event) => setBankSearch(event.target.value)} placeholder="Search banks by name" className="w-full rounded-lg border border-slate-300 px-3 py-2 sm:max-w-sm" />
        {bankLoading ? <p className="py-10 text-center text-sm text-slate-500">Loading your question banks…</p> : filteredBanks.length === 0 ? <div className="mt-4 rounded-xl border-2 border-dashed border-slate-200 p-8 text-center"><p className="font-semibold text-slate-700">{banks.length ? "No matching banks" : "Your question bank is empty"}</p><p className="mt-1 text-sm text-slate-500">Create a bank to save reusable questions.</p></div> : <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {filteredBanks.map((bank) => <article key={bank.id} className="rounded-xl border border-slate-200 p-4">
            <button type="button" onClick={() => void loadBankQuestions(bank)} className="block w-full text-left">
              <h3 className="text-lg font-bold text-slate-800">{bank.name}</h3>
              <p className="mt-1 min-h-5 text-sm text-slate-500">{bank.description || "No description"}</p>
              <p className="mt-3 text-xs font-semibold text-indigo-700">{bank.questionCount} questions</p>
            </button>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setBankForm({ id: bank.id, name: bank.name, description: bank.description })} className="text-xs font-semibold text-indigo-700">Edit</button>
              <button type="button" onClick={() => void duplicateBank(bank)} className="text-xs font-semibold text-slate-600">Duplicate</button>
              <button type="button" onClick={() => void deleteBank(bank)} className="text-xs font-semibold text-rose-600">Delete</button>
            </div>
          </article>)}
        </div>}
      </div> : <div className="mt-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div><button type="button" onClick={() => { setActiveBank(null); setQuestions([]); }} className="text-sm font-semibold text-indigo-700">← All banks</button><h3 className="mt-2 text-xl font-bold text-slate-800">{activeBank.name}</h3><p className="mt-1 text-sm text-slate-500">{activeBank.description}</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportBank} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Export JSON</button>
            <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Import JSON<input type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importFile(event)} /></label>
            <button type="button" onClick={() => openEditor()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white">Add question</button>
          </div>
        </div>
        {questionLoading ? <p className="py-10 text-center text-sm text-slate-500">Loading questions…</p> : <>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input aria-label="Search questions" value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="Search questions" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2" />
            <span className="text-sm text-slate-500">{questions.length} questions</span>
          </div>
          {questions.length === 0 ? <div className="mt-4 rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">This bank is empty. Add a question manually or import a JSON file.</div> : <div className="mt-4 space-y-3">
            {filteredQuestions.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start gap-3">
                <input aria-label={`Select ${questionLabel(item.questionData)}`} type="checkbox" checked={selectedQuestionIds.includes(item.id)} onChange={() => setSelectedQuestionIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} className="mt-1 h-4 w-4 accent-indigo-600" />
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-slate-800">{questionLabel(item.questionData)}</h4>
                  <p className="mt-1 text-sm text-slate-500">{Array.isArray(item.questionData.options) ? item.questionData.options.map(String).join(" · ") : ""}</p>
                  <p className="mt-1 text-xs text-slate-500">Correct: {String(item.questionData.correct || "")} · {String(item.questionData.timeLimit || 20)}s</p>
                  {typeof item.questionData.explanation === "string" && <p className="mt-2 text-sm text-slate-600">{item.questionData.explanation}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => openEditor(item)} className="text-xs font-semibold text-indigo-700">Edit</button>
                  <button type="button" onClick={() => void duplicateQuestion(item)} className="text-xs font-semibold text-slate-600">Duplicate</button>
                  <button type="button" onClick={() => void deleteQuestion(item)} className="text-xs font-semibold text-rose-600">Delete</button>
                </div>
              </div>
            </article>)}
            {filteredQuestions.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No questions match this search.</p>}
          </div>}
          {selectedQuestionIds.length > 0 && <div className="mt-4 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center">
            <span className="text-sm font-semibold text-slate-700">{selectedQuestionIds.length} selected</span>
            <select aria-label="Destination bank" value={destinationBankId} onChange={(event) => setDestinationBankId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Choose another bank</option>{banks.filter((bank) => bank.id !== activeBank.id).map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
            </select>
            <button type="button" disabled={!destinationBankId} onClick={() => void transferQuestions("copy")} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-40">Copy</button>
            <button type="button" disabled={!destinationBankId} onClick={() => void transferQuestions("move")} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Move</button>
          </div>}
        </>}
      </div>}

      {bankForm && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-3" role="dialog" aria-modal="true" aria-labelledby="bank-form-title">
        <form onSubmit={(event) => void saveBank(event)} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
          <h3 id="bank-form-title" className="text-xl font-bold text-slate-800">{bankForm.id ? "Edit question bank" : "Create question bank"}</h3>
          <label className="block text-sm font-semibold text-slate-700">Name<input required maxLength={80} value={bankForm.name} onChange={(event) => setBankForm({ ...bankForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-semibold text-slate-700">Description<textarea maxLength={500} rows={3} value={bankForm.description} onChange={(event) => setBankForm({ ...bankForm, description: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setBankForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button><button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Save bank</button></div>
        </form>
      </div>}

      {questionForm && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 p-3 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="question-form-title">
        <form onSubmit={(event) => void saveQuestion(event)} className="mx-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-4rem)] sm:space-y-5 sm:p-7">
          <div>
            <h3 id="question-form-title" className="text-xl font-bold text-slate-800">{questionForm.id ? "Edit question" : "Add question"}</h3>
            <p className="mt-1 text-sm text-slate-500">Choose the correct answer with its circle. You can add up to {MAX_QUESTION_OPTIONS} options.</p>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Question<textarea autoFocus required maxLength={500} rows={2} value={questionForm.value.question} onChange={(event) => setQuestionForm({ ...questionForm, value: { ...questionForm.value, question: event.target.value } })} placeholder="Write your question" className="mt-1 w-full min-w-0 resize-y rounded-xl border border-slate-300 px-3 py-3 text-base font-normal text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" /></label>
          <fieldset className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="text-sm font-semibold text-slate-700">Answer options</legend>
              <span className="text-xs text-slate-500">Select one correct answer</span>
            </div>
            {questionForm.value.options.map((option, index) => {
              const letter = String.fromCharCode(65 + index);
              const correct = questionForm.value.correctOptionIndex === index;
              return <div key={index} className={`flex min-w-0 items-center gap-2 rounded-xl border-2 p-2 transition-colors ${correct ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                <label className={`flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 text-sm font-bold ${correct ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                  <input
                    type="radio"
                    name="correct-option"
                    aria-label={`Mark option ${letter} as correct`}
                    checked={correct}
                    onChange={() => setQuestionForm({ ...questionForm, value: selectCorrectQuestionOption(questionForm.value, index) })}
                    className="h-5 w-5 accent-emerald-600"
                  />
                  {letter}
                </label>
                <input type="text" maxLength={200} aria-label={`Option ${letter} answer`} value={option} onChange={(event) => setQuestionForm({ ...questionForm, value: { ...questionForm.value, options: questionForm.value.options.map((value, optionIndex) => optionIndex === index ? event.target.value : value) } })} placeholder={`Option ${letter}`} className="min-h-11 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <button type="button" aria-label={`Remove option ${letter}`} disabled={questionForm.value.options.length <= 2} onClick={() => {
                  const next = removeQuestionOption(questionForm.value.options, questionForm.value.correctOptionIndex, index);
                  setQuestionForm({ ...questionForm, value: { ...questionForm.value, ...next } });
                }} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-xl text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30">×</button>
              </div>;
            })}
            <button type="button" disabled={questionForm.value.options.length >= MAX_QUESTION_OPTIONS} onClick={() => setQuestionForm({ ...questionForm, value: { ...questionForm.value, options: addQuestionOption(questionForm.value.options) } })} className="min-h-11 w-full rounded-xl border border-dashed border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">+ Add option</button>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-700">Question timer</legend>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {QUESTION_TIMER_PRESETS.map((seconds) => <button key={seconds} type="button" aria-pressed={Number(questionForm.value.timeLimit) === seconds} onClick={() => setQuestionForm({ ...questionForm, value: { ...questionForm.value, timeLimit: String(seconds) } })} className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${Number(questionForm.value.timeLimit) === seconds ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300"}`}>{seconds}s</button>)}
            </div>
            <label className="mt-2 flex items-center gap-3 text-sm font-medium text-slate-700">Custom seconds<input type="number" min={5} max={120} required value={questionForm.value.timeLimit} onChange={(event) => setQuestionForm({ ...questionForm, value: { ...questionForm.value, timeLimit: event.target.value } })} className="min-h-11 w-28 rounded-xl border border-slate-300 px-3 text-base" /></label>
          </fieldset>
          <label className="block text-sm font-semibold text-slate-700">Explanation <span className="font-normal text-slate-500">(optional)</span><textarea maxLength={4000} rows={2} value={questionForm.value.explanation} onChange={(event) => setQuestionForm({ ...questionForm, value: { ...questionForm.value, explanation: event.target.value } })} className="mt-1 w-full min-w-0 rounded-xl border border-slate-300 px-3 py-3 text-base font-normal" /></label>
          <details className="rounded-xl border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Advanced settings</summary>
            <label className="mt-3 block text-sm font-medium text-slate-600">Additional question metadata (JSON)<textarea rows={4} value={questionForm.value.metadata} onChange={(event) => setQuestionForm({ ...questionForm, value: { ...questionForm.value, metadata: event.target.value } })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" /></label>
          </details>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 pt-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setQuestionForm(null)} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button><button type="submit" className="min-h-11 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white">Save question</button></div>
        </form>
      </div>}
      {notice && <p role="status" className="mt-4 text-sm text-emerald-700">{notice}</p>}
    </section>
  );
}
