export const ERROR_CODES = ["NOT_FOUND", "INVALID_ARGUMENT", "PARSE_FAILED"] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

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
