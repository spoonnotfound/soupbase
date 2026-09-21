import type { PuzzleInput } from "@/shared/puzzle";

const licenses = {
  "CC0-1.0": {
    label: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  "CC-BY-SA-3.0": {
    label: "CC BY-SA 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0/",
  },
  "CC-BY-SA-4.0": {
    label: "CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
} as const;

export function PuzzleSource({
  source,
  en,
}: {
  source: PuzzleInput["source"];
  en: boolean;
}) {
  const license = source.license ? licenses[source.license] : undefined;
  return (
    <details className="puzzle-source small">
      <summary>{en ? "Source and license" : "来源与许可"}</summary>
      <p>{source.author}</p>
      <div className="actions">
        {source.url && (
          <a href={source.url} target="_blank" rel="noreferrer">
            {en ? "Original (contains the solution) ↗" : "原作（含汤底）↗"}
          </a>
        )}
        {license && (
          <a href={license.url} target="_blank" rel="noreferrer">
            {license.label}
          </a>
        )}
      </div>
      {source.note && <p className="muted">{source.note}</p>}
    </details>
  );
}
