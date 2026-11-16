export const MAX_QUESTION_OPTIONS = 8;
export const QUESTION_TIMER_PRESETS = [10, 15, 20, 30, 45, 60] as const;

export type QuestionFormValue = {
  question: string;
  options: string[];
  correctOptionIndex: number | null;
  timeLimit: string;
  explanation: string;
  metadata: string;
};

export function createQuestionFormValue(): QuestionFormValue {
  return {
    question: "",
    options: ["", "", "", ""],
    correctOptionIndex: null,
    timeLimit: "20",
    explanation: "",
    metadata: "{}",
  };
}

export function addQuestionOption(options: string[]): string[] {
  return options.length >= MAX_QUESTION_OPTIONS ? options : [...options, ""];
}

export function selectCorrectQuestionOption(value: QuestionFormValue, index: number): QuestionFormValue {
  if (index < 0 || index >= value.options.length) return value;
  return { ...value, correctOptionIndex: index };
}

export function removeQuestionOption(
  options: string[],
  correctOptionIndex: number | null,
  index: number,
): { options: string[]; correctOptionIndex: number | null } {
  if (options.length <= 2 || index < 0 || index >= options.length) {
    return { options, correctOptionIndex };
  }
  return {
    options: options.filter((_, optionIndex) => optionIndex !== index),
    correctOptionIndex: correctOptionIndex === index
      ? null
      : correctOptionIndex !== null && correctOptionIndex > index
        ? correctOptionIndex - 1
        : correctOptionIndex,
  };
}

export function buildQuestionData(value: QuestionFormValue): { questionData?: Record<string, unknown>; error?: string } {
  const question = value.question.trim();
  if (!question) return { error: "Enter a question." };
  if (question.length > 500) return { error: "Question text must be 500 characters or fewer." };

  const normalizedOptions = value.options.map((option) => option.trim());
  const options = normalizedOptions.filter(Boolean);
  if (options.length < 2) return { error: "Add at least two non-empty answer options." };
  if (options.length > MAX_QUESTION_OPTIONS) return { error: `Use no more than ${MAX_QUESTION_OPTIONS} answer options.` };
  if (options.some((option) => option.length > 200)) return { error: "Each answer option must be 200 characters or fewer." };
  const uniqueOptions = new Set(options.map((option) => option.toLocaleLowerCase("en")));
  if (uniqueOptions.size !== options.length) return { error: "Answer options must be unique." };

  const correctAnswer = value.correctOptionIndex === null ? "" : normalizedOptions[value.correctOptionIndex];
  if (!correctAnswer) return { error: "Select the correct answer." };
  if (!options.some((option) => option === correctAnswer)) return { error: "Select a non-empty answer option as correct." };

  const timeLimit = Number(value.timeLimit);
  if (!Number.isInteger(timeLimit) || timeLimit < 5 || timeLimit > 120) {
    return { error: "Timer must be from 5 to 120 seconds." };
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(value.metadata || "{}");
  } catch {
    return { error: "Advanced metadata must be valid JSON." };
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { error: "Advanced metadata must be a JSON object." };
  }

  const explanation = value.explanation.trim();
  if (explanation.length > 4000) return { error: "Explanation must be 4,000 characters or fewer." };
  return {
    questionData: {
      ...metadata,
      question,
      options,
      correct: correctAnswer,
      timeLimit,
      ...(explanation ? { explanation } : {}),
    },
  };
}
