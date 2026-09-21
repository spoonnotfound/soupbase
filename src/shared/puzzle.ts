import { z } from "zod";
import type { TurnConfidence } from "./confidence";
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((s) => [...s].length <= max, "Text is too long");
export const decisions = ["yes", "no", "irrelevant", "uncertain"] as const;
export type Decision = (typeof decisions)[number];
// Old games keep working with the simpler host.
export function normalizeHostDecision(value: string): Decision {
  return decisions.includes(value as Decision)
    ? (value as Decision)
    : "uncertain";
}
export const puzzleSchema = z
  .strictObject({
    schema_version: z.literal("1.0"),
    language: z.enum(["zh", "en"]),
    title: text(80),
    surface: text(2000),
    solution: text(6000),
    facts: z
      .array(
        z.strictObject({
          id: z.string().regex(/^f[1-9][0-9]*$/),
          text: text(500),
          required: z.boolean(),
        }),
      )
      .min(1)
      .max(8),
    unknowns: z.array(text(500)).max(20).default([]),
    character_claims: z.array(text(500)).max(20).default([]),
    // Accepted only for older imports; discarded below and never sent to Jev.
    irrelevant_topics: z.array(text(100)).max(20).optional(),
    hints: z.array(text(500)).max(3).default([]),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    tags: z.array(text(30)).max(8).default([]),
    source: z.strictObject({
      kind: z.enum(["original", "adapted", "licensed"]),
      author: text(100),
      license: z.enum(["CC0-1.0", "CC-BY-SA-3.0", "CC-BY-SA-4.0"]).optional(),
      url: z
        .string()
        .max(1000)
        .refine((s) => !s || /^https?:\/\//.test(s))
        .optional(),
      note: z.string().max(2000).optional(),
    }),
  })
  .superRefine((p, c) => {
    if (new Set(p.facts.map((f) => f.id)).size !== p.facts.length)
      c.addIssue({
        code: "custom",
        path: ["facts"],
        message: "Fact IDs must be unique",
      });
    if (!p.facts.some((f) => f.required))
      c.addIssue({
        code: "custom",
        path: ["facts"],
        message: "At least one required fact is needed",
      });
    if (p.source.kind !== "original" && !p.source.note?.trim())
      c.addIssue({
        code: "custom",
        path: ["source", "note"],
        message: "Describe your permission to use this story",
      });
  })
  .transform(({ irrelevant_topics: _legacy, ...puzzle }) => puzzle);
export type PuzzleInput = z.infer<typeof puzzleSchema>;
export type PublicPuzzle = {
  id: string;
  revision: string;
  title: string;
  surface: string;
  language: "zh" | "en";
  difficulty: string;
  tags: string[];
  source: PuzzleInput["source"];
  hintTotal: number;
  visibility: string;
};
export function publicContent(p: PuzzleInput) {
  return {
    title: p.title,
    surface: p.surface,
    language: p.language,
    difficulty: p.difficulty,
    tags: p.tags,
    source: p.source,
    hintTotal: p.hints.length,
  };
}
export type Game = {
  id: string;
  status: "active" | "solved" | "revealed";
  puzzle: PublicPuzzle;
  hints: string[];
  turns: {
    id: string;
    kind: string;
    input: string;
    decision: string;
    status: string;
    confidence: TurnConfidence | null;
    response?: unknown;
  }[];
  solution?: string;
};
