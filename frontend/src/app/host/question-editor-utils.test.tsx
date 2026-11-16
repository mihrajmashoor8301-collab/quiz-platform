import { describe, expect, it } from "vitest";
import {
  addQuestionOption,
  buildQuestionData,
  createQuestionFormValue,
  removeQuestionOption,
  selectCorrectQuestionOption,
} from "./question-editor-utils";

describe("question builder option controls and validation", () => {
  it("starts with A-D and adds and removes options while preserving the minimum and selected answer", () => {
    const initial = createQuestionFormValue();
    expect(initial.options).toEqual(["", "", "", ""]);

    const expanded = addQuestionOption(initial.options);
    expect(expanded).toHaveLength(5);
    const selected = selectCorrectQuestionOption({ ...initial, options: expanded }, 3);
    expect(selected.correctOptionIndex).toBe(3);

    const afterRemoval = removeQuestionOption(selected.options, selected.correctOptionIndex, 1);
    expect(afterRemoval.options).toHaveLength(4);
    expect(afterRemoval.correctOptionIndex).toBe(2);
    const twoOptions = removeQuestionOption(["A", "B", "C"], 1, 0);
    expect(removeQuestionOption(twoOptions.options, twoOptions.correctOptionIndex, 0).options).toHaveLength(2);
  });

  it("requires a question, two unique options, and a selected correct answer", () => {
    const value = createQuestionFormValue();
    expect(buildQuestionData(value).error).toMatch(/question/i);

    value.question = "Pick one";
    value.options = ["Water", "Water", "", ""];
    value.correctOptionIndex = 0;
    expect(buildQuestionData(value).error).toMatch(/unique/i);

    value.options = ["Water", "Air", "", ""];
    value.correctOptionIndex = null;
    expect(buildQuestionData(value).error).toMatch(/correct answer/i);
  });

  it("serializes the selected option text as the backend correct-answer field", () => {
    let value = createQuestionFormValue();
    value = {
      ...value,
      question: " Pick one ",
      options: ["Water", "Air", "", ""],
      timeLimit: "30",
      explanation: " A short reason. ",
      metadata: '{"source":"unit-1"}',
    };
    value = selectCorrectQuestionOption(value, 1);

    expect(buildQuestionData(value).questionData).toEqual({
      source: "unit-1",
      question: "Pick one",
      options: ["Water", "Air"],
      correct: "Air",
      timeLimit: 30,
      explanation: "A short reason.",
    });
  });

  it("rejects empty options, invalid timers, and malformed advanced metadata", () => {
    let value = createQuestionFormValue();
    value = { ...value, question: "Question", options: ["One", "", "", ""] };
    expect(buildQuestionData(value).error).toMatch(/at least two/i);

    value = { ...value, options: ["One", "Two", "", ""], timeLimit: "121", metadata: "{" };
    value = selectCorrectQuestionOption(value, 0);
    expect(buildQuestionData(value).error).toMatch(/timer/i);
    value = { ...value, timeLimit: "20" };
    expect(buildQuestionData(value).error).toMatch(/valid JSON/i);
  });
});
