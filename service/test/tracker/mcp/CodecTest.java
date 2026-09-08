package tracker.mcp;

/** Standalone adversarial tests; no native Tracker initialization. GPL-3. */
public final class CodecTest {
  public static void main(String[] args) throws Exception {
    for (String bad : new String[]{"{\"a\":1,\"a\":2}", "[1,]", "01", "1e999", "{\"x\":NaN}", "\"a\n\"", "true false", "\"\\u+123\"", "\"\\u-123\"", "[".repeat(40)+"]".repeat(40)}) {
      try { Json.parse(bad); throw new AssertionError("accepted " + bad); }
      catch (IllegalArgumentException expected) {}
    }
    String json = "{\"a\":[1,-2.5,true,null,\"hello\\nworld\"]}";
    if (!Json.parse(json).equals(Json.parse(Json.stringify(Json.parse(json))))) throw new AssertionError("roundtrip");
    if (!Json.parse("9007199254740991").equals(9007199254740991L)) throw new AssertionError("integer precision");
    System.out.println("CodecTest passed");
  }
}
