export type ErrorCode = "NOT_FOUND" | "INVALID_ARGUMENT" | "PARSE_FAILED";

export type ErrorEnvelope = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
};

export function fail(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { ok: false, error: { code, message, details } };
}
