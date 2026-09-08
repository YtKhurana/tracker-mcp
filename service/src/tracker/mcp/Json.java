package tracker.mcp;

import java.util.*;

/** Strict bounded JSON codec. GPL-3. No object deserialization hooks. */
final class Json {
  static final int MAX = 2 * 1024 * 1024;
  private final String text;
  private int pos;
  private Json(String text) { this.text = text; }
  static Object parse(String text) {
    if (text.length() > MAX) throw new IllegalArgumentException("JSON too large");
    Json parser = new Json(text);
    Object value = parser.value(0);
    parser.space();
    if (parser.pos != text.length()) throw parser.bad();
    return value;
  }
  private IllegalArgumentException bad() { return new IllegalArgumentException("Invalid JSON at offset " + pos); }
  private void space() { while (pos < text.length() && " \r\n\t".indexOf(text.charAt(pos)) >= 0) pos++; }
  private boolean eat(char c) { space(); if (pos < text.length() && text.charAt(pos) == c) { pos++; return true; } return false; }
  private Object value(int depth) {
    if (depth > 32) throw bad();
    space(); if (pos >= text.length()) throw bad();
    char c = text.charAt(pos);
    if (c == '"') return string();
    if (c == '{') {
      pos++; Map<String,Object> map = new LinkedHashMap<>();
      if (eat('}')) return map;
      do { space(); if (pos >= text.length() || text.charAt(pos) != '"') throw bad();
        String key = string(); if (!eat(':') || map.containsKey(key)) throw bad();
        map.put(key, value(depth+1));
      } while (eat(','));
      if (!eat('}')) throw bad(); return map;
    }
    if (c == '[') {
      pos++; List<Object> list = new ArrayList<>(); if (eat(']')) return list;
      do { list.add(value(depth+1)); } while (eat(','));
      if (!eat(']')) throw bad(); return list;
    }
    for (String literal : new String[]{"true","false","null"}) if (text.startsWith(literal,pos)) {
      pos += literal.length(); return literal.equals("null") ? null : Boolean.valueOf(literal);
    }
    int start = pos;
    if (text.charAt(pos) == '-') pos++;
    if (pos >= text.length()) throw bad();
    if (text.charAt(pos) == '0') pos++;
    else { int digits = pos; while (pos < text.length() && text.charAt(pos)>='0' && text.charAt(pos)<='9') pos++; if (digits == pos) throw bad(); }
    boolean decimal = false;
    if (pos < text.length() && text.charAt(pos)=='.') {
      decimal=true; pos++; int digits=pos; while(pos<text.length() && Character.isDigit(text.charAt(pos))) pos++; if(digits==pos) throw bad();
    }
    if(pos<text.length() && (text.charAt(pos)=='e'||text.charAt(pos)=='E')) {
      decimal=true; pos++; if(pos<text.length() && (text.charAt(pos)=='+'||text.charAt(pos)=='-'))pos++;
      int digits=pos; while(pos<text.length() && Character.isDigit(text.charAt(pos)))pos++; if(digits==pos)throw bad();
    }
    try { String number=text.substring(start,pos); if(!decimal)return Long.valueOf(number);
      double d=Double.parseDouble(number); if(!Double.isFinite(d))throw bad(); return d;
    } catch(NumberFormatException failure) { throw bad(); }
  }
  private String string() {
    pos++; StringBuilder b=new StringBuilder();
    while(pos<text.length()) {
      char c=text.charAt(pos++); if(c=='"')return b.toString(); if(c<32)throw bad();
      if(c=='\\') { if(pos>=text.length())throw bad(); char e=text.charAt(pos++);
        switch(e) {
          case '"','\\','/' -> b.append(e);
          case 'b' -> b.append('\b'); case 'f' -> b.append('\f'); case 'n' -> b.append('\n'); case 'r' -> b.append('\r'); case 't' -> b.append('\t');
          case 'u' -> { if(pos+4>text.length()||!text.substring(pos,pos+4).matches("[0-9a-fA-F]{4}"))throw bad(); b.append((char)Integer.parseInt(text.substring(pos,pos+4),16)); pos+=4; }
          default -> throw bad();
        }
      } else b.append(c);
    }
    throw bad();
  }
  static String stringify(Object value) {
    if(value==null)return "null";
    if(value instanceof String s) { StringBuilder b=new StringBuilder("\""); for(char c:s.toCharArray()) {
      if(c=='"'||c=='\\')b.append('\\').append(c); else if(c<32)b.append(String.format("\\u%04x",(int)c)); else b.append(c);
    } return b.append('"').toString(); }
    if(value instanceof Number n) { if(!Double.isFinite(n.doubleValue()))throw new IllegalArgumentException("nonfinite JSON"); return n.toString(); }
    if(value instanceof Boolean)return value.toString();
    if(value instanceof Map<?,?> map) { StringJoiner j=new StringJoiner(",","{","}"); map.forEach((k,v)->j.add(stringify(k.toString())+":"+stringify(v))); return j.toString(); }
    if(value instanceof Iterable<?> list) { StringJoiner j=new StringJoiner(",","[","]"); for(Object v:list)j.add(stringify(v)); return j.toString(); }
    throw new IllegalArgumentException("Not JSON: "+value.getClass());
  }
}
