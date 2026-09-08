package tracker.mcp;

/** Wire-safe expected error. GPL-3. */
final class Failure extends RuntimeException {
  final String code;
  Failure(String code, String message) { super(message); this.code=code; }
  static Failure invalid(String message) { return new Failure("INVALID_ARGUMENT",message); }
}
