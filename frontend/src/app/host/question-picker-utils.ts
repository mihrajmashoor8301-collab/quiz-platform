export type PickableQuestion = { id: string; questionData: Record<string, unknown> };

export function toggleBankQuestionSelection(
  selection: Record<string, Record<string, unknown>>,
  questions: PickableQuestion[],
  maxSelection: number,
): { selection: Record<string, Record<string, unknown>>; overflow: number } {
  if (questions.length > 0 && questions.every((question) => selection[question.id])) {
    const next = { ...selection };
    questions.forEach((question) => { delete next[question.id]; });
    return { selection: next, overflow: 0 };
  }

  const next = { ...selection };
  let overflow = 0;
  for (const question of questions) {
    if (next[question.id]) continue;
    if (Object.keys(next).length >= Math.max(0, maxSelection)) {
      overflow += 1;
      continue;
    }
    next[question.id] = question.questionData;
  }
  return { selection: next, overflow };
}
