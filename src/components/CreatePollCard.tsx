"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./createPoll.module.css";

const blankOption = () => "";

export function CreatePollCard() {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([blankOption(), blankOption()]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const normalizedOptions = useMemo(() => options.map((option) => option.trim()).filter(Boolean), [options]);

  const isValid =
    question.trim().length >= 5 &&
    question.trim().length <= 200 &&
    normalizedOptions.length >= 2 &&
    normalizedOptions.length <= 8;

  const updateOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((option, i) => (i === index ? value : option)));
  };

  const addOption = () => {
    if (options.length < 8) {
      setOptions((prev) => [...prev, blankOption()]);
    }
  };

  const removeOption = (index: number) => {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setServerError(null);

    const trimmedQuestion = question.trim();
    const cleanedOptions = options.map((option) => option.trim()).filter(Boolean);

    if (trimmedQuestion.length < 5 || trimmedQuestion.length > 200) {
      setFieldError("Question must be between 5 and 200 characters.");
      return;
    }
    if (cleanedOptions.length < 2) {
      setFieldError("Please add at least 2 options.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion, options: cleanedOptions }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setServerError(payload.error ?? "Could not create poll.");
        return;
      }

      router.push(`/room/${payload.data.code}`);
    } catch (error) {
      console.error(error);
      setServerError("Network error while creating poll.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={`card ${styles.card}`}>
      <h1>Create a live poll</h1>
      <p>Share a room link and watch votes arrive in realtime.</p>
      <form onSubmit={handleSubmit} className={styles.form}>
        <label>
          Question
          <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={200} />
        </label>

        <div className={styles.optionsHeader}>
          <span>Options</span>
          <button type="button" onClick={addOption} disabled={options.length >= 8}>
            + Add option
          </button>
        </div>

        {options.map((option, index) => (
          <div className={styles.optionRow} key={index}>
            <input
              value={option}
              onChange={(event) => updateOption(index, event.target.value)}
              placeholder={`Option ${index + 1}`}
              maxLength={80}
            />
            <button type="button" onClick={() => removeOption(index)} disabled={options.length <= 2}>
              Remove
            </button>
          </div>
        ))}

        {fieldError && <p className={styles.error}>{fieldError}</p>}
        {serverError && <p className={styles.error}>{serverError}</p>}

        <button type="submit" disabled={!isValid || isSubmitting} className={styles.submitBtn}>
          {isSubmitting ? "Creating..." : "Create poll room"}
        </button>
      </form>
    </section>
  );
}
