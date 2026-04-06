export interface CodexCommandValidationOk {
  ok: true;
  executable: string;
}

export interface CodexCommandValidationError {
  ok: false;
  error_code: "invalid_command_configuration";
  configured_command: string;
  reason: string;
}

export type CodexCommandValidationResult = CodexCommandValidationOk | CodexCommandValidationError;

function tokenizeCommand(raw: string): { tokens: string[]; parseError: string | null } {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (const char of raw) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return {
      tokens: [],
      parseError: "Comillas sin cierre en wisContextSync.codexCliCommand.",
    };
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return {
    tokens,
    parseError: null,
  };
}

export function validateCodexExecutableCommand(command: string | null | undefined): CodexCommandValidationResult {
  const trimmed = command?.trim() ?? "";
  if (!trimmed) {
    return {
      ok: true,
      executable: "codex",
    };
  }

  const parsed = tokenizeCommand(trimmed);
  if (parsed.parseError) {
    return {
      ok: false,
      error_code: "invalid_command_configuration",
      configured_command: trimmed,
      reason: parsed.parseError,
    };
  }

  if (parsed.tokens.length !== 1) {
    return {
      ok: false,
      error_code: "invalid_command_configuration",
      configured_command: trimmed,
      reason: "Configura solo el ejecutable o ruta absoluta, sin argumentos embebidos.",
    };
  }

  const executable = parsed.tokens[0].trim();
  if (!executable) {
    return {
      ok: false,
      error_code: "invalid_command_configuration",
      configured_command: trimmed,
      reason: "El ejecutable de codex no puede quedar vacío.",
    };
  }

  return {
    ok: true,
    executable,
  };
}
