export type ReusableQuestion = Record<string, unknown> & {
  question?: string;
  text?: string;
  options?: string[];
  correct?: string;
  timeLimit?: number;
};

/** Keep quiz drafts independent from the JSON objects received from a bank. */
export function cloneQuestionsForQuiz(questions: ReusableQuestion[]): ReusableQuestion[] {
  return questions.map((question) => JSON.parse(JSON.stringify(question)) as ReusableQuestion);
}
