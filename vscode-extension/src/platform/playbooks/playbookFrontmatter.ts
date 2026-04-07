export type PlaybookKind = "followup" | "validation" | "recovery" | "operator_action";

export type PlaybookAction = "local_prepare_task" | "local_run_codex" | "post_review" | "local_refresh";

export interface PlaybookFrontmatter {
  id: string;
  title: string;
  kind: PlaybookKind;
  priority: number;
  applies_to: PlaybookAction[];
  tags?: string[];
}

export interface ParsedPlaybook {
  frontmatter: PlaybookFrontmatter;
  body: string;
  sourcePath: string;
  sourceTier: "system" | "workspace" | "project";
}

const VALID_KINDS = new Set<PlaybookKind>(["followup", "validation", "recovery", "operator_action"]);
const VALID_ACTIONS = new Set<PlaybookAction>([
  "local_prepare_task",
  "local_run_codex",
  "post_review",
  "local_refresh",
]);

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parsePlaybookDocument(
  raw: string,
  sourcePath: string,
  sourceTier: ParsedPlaybook["sourceTier"],
): ParsedPlaybook {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    throw new Error(`Playbook sin frontmatter válido: ${sourcePath}`);
  }

  const [, header, body] = match;
  const map = new Map<string, string>();

  for (const line of header.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }

  const id = map.get("id");
  const title = map.get("title");
  const kindRaw = map.get("kind");
  const priority = Number(map.get("priority") ?? "100");
  const appliesToRaw = splitCsv(map.get("applies_to"));
  const tags = splitCsv(map.get("tags"));

  if (!id || !title || !kindRaw || Number.isNaN(priority) || appliesToRaw.length === 0) {
    throw new Error(`Frontmatter incompleto en playbook: ${sourcePath}`);
  }

  if (!VALID_KINDS.has(kindRaw as PlaybookKind)) {
    throw new Error(`kind inválido en playbook: ${sourcePath}`);
  }

  const appliesTo = appliesToRaw.filter((entry): entry is PlaybookAction => VALID_ACTIONS.has(entry as PlaybookAction));
  if (appliesTo.length === 0) {
    throw new Error(`applies_to inválido en playbook: ${sourcePath}`);
  }

  return {
    frontmatter: {
      id,
      title,
      kind: kindRaw as PlaybookKind,
      priority,
      applies_to: appliesTo,
      tags,
    },
    body: body.trim(),
    sourcePath,
    sourceTier,
  };
}
