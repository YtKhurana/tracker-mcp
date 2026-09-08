export const ERROR_CODES = ["NOT_FOUND", "INVALID_ARGUMENT", "PARSE_FAILED"] as const;
export const V1_ERROR_CODES = ["UNSUPPORTED_TYPE", "NO_SESSION", "SESSION_BUSY", "SERVICE_UNAVAILABLE", "JAVA_EXIT", "TIMEOUT", "VIDEO_DECODE", "SAVE_FAILED", "EXPORT_EMPTY"] as const;
export const ALL_ERROR_CODES = [...ERROR_CODES, ...V1_ERROR_CODES] as const;

export type ErrorCode = (typeof ALL_ERROR_CODES)[number];

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
