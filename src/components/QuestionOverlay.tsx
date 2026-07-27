import { useEffect, useState } from "react";
import type { UserInputRequest } from "../hooks/useCodexSession";

type Props = {
  request: UserInputRequest;
  onSubmit(answers: Record<string, string>): void;
};

export function QuestionOverlay({ request, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => {
    setAnswers(Object.fromEntries(request.questions.map((question) => [question.id, question.options?.[0]?.label || ""])));
  }, [request]);
  return (
    <div className="overlay-backdrop question-backdrop" role="dialog" aria-modal="true" aria-labelledby="question-title">
      <div className="approval-card question-card">
        <div className="approval-kicker"><span>INPUT REQUIRED</span><i /></div>
        <h2 id="question-title">Codexから確認があります</h2>
        <div className="question-list">
          {request.questions.map((question) => (
            <fieldset key={question.id}>
              <legend><span>{question.header}</span>{question.question}</legend>
              {question.options?.map((option) => (
                <label key={option.label} className={answers[question.id] === option.label ? "is-selected" : ""}>
                  <input type="radio" name={question.id} value={option.label} checked={answers[question.id] === option.label} onChange={() => setAnswers({ ...answers, [question.id]: option.label })} />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
              {question.isOther && <input className="text-control" type={question.isSecret ? "password" : "text"} placeholder="その他の回答" onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} />}
            </fieldset>
          ))}
        </div>
        <div className="approval-actions"><button className="button-primary" onClick={() => onSubmit(answers)}><kbd>A</kbd>回答を送信</button></div>
      </div>
    </div>
  );
}
