export const CONFIDENCE_THRESHOLD = 0.7;
// Display only, and only for host turns saved before decisions became confidence-driven.
export const HOST_LOW_CONFIDENCE_THRESHOLD = 0.7;
// Below this host confidence the answer becomes "uncertain" instead of Jev's label.
export const HOST_UNCERTAIN_THRESHOLD = 0.45;

export type TurnConfidence = {
  score: number | null;
  threshold: number | null;
  checks: { kind: "answer" | "fact" | "coherence"; score: number | null }[];
};
