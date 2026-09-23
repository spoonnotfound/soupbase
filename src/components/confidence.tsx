import {
  HOST_LOW_CONFIDENCE_THRESHOLD,
  type TurnConfidence,
} from "@/shared/confidence";

// Preserve small differences around the threshold instead of rounding 0.899 to 0.90.
function formatScore(score: number | null) {
  return score === null ? "—" : String(score);
}

export function Confidence({
  value,
  en,
}: {
  value: TurnConfidence;
  en: boolean;
}) {
  const isGuess = value.checks.some((check) => check.kind === "fact");
  return (
    <details className="confidence">
      <summary>
        Confidence {formatScore(value.score)}
        {isGuess && (en ? " · lowest score" : " · 最低项")}
        {!isGuess &&
          value.threshold === null &&
          value.score !== null &&
          value.score < HOST_LOW_CONFIDENCE_THRESHOLD && (
            <span>{en ? " · low confidence" : " · 把握较低"}</span>
          )}
        {value.score !== null &&
          value.threshold !== null &&
          value.score < value.threshold && (
            <span>
              {en ? " · below threshold " : " · 低于阈值 "}
              {formatScore(value.threshold)}
            </span>
          )}
      </summary>
      <div className="confidence-details">
        {isGuess && (
          <ul>
            {value.checks.map((check, index) => (
              <li key={index}>
                {check.kind === "coherence"
                  ? en
                    ? "Overall coherence"
                    : "整体一致性"
                  : `${en ? "Key point" : "关键点"} ${index + 1}`}
                {": "}
                {formatScore(check.score)}
              </li>
            ))}
          </ul>
        )}
        <p>
          {value.threshold === null
            ? en
              ? "For reference only; this score does not change the host's answer"
              : "评分仅供参考，不改变主持人的回答"
            : `${en ? "Decision threshold: " : "判定阈值："}${formatScore(value.threshold)}`}
          {value.threshold !== null &&
            !isGuess &&
            (en
              ? `. Below it the host answers "cannot determine".`
              : "。低于该值时主持人回答「无法确认」。")}
          {en
            ? ". Confidence measures how concentrated the option probabilities are, not the probability that an answer is correct."
            : "。Confidence 表示选项概率分布的集中程度，不代表答案正确率。"}
          {isGuess &&
            (en
              ? " The summary uses the lowest check score. Solving also requires all key facts and a coherent explanation."
              : "汇总取各检查项最低分；通关还需关键事实全部成立、解释一致。")}
          {value.score === null &&
            (en ? " Some scores are unavailable." : "部分评分未提供。")}
        </p>
      </div>
    </details>
  );
}
