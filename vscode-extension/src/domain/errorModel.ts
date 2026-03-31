export type IssueKind = "transport" | "protocol" | "domain" | "local" | "presentation";
export type IssueSeverity = "info" | "warning" | "error";

export interface OperationalIssue {
  kind: IssueKind;
  source: string;
  severity: IssueSeverity;
  message: string;
  recoverable: boolean;
  evidence_hint: string;
  conflict_flag?: string;
}

export function makeIssue(issue: OperationalIssue): OperationalIssue {
  return issue;
}
