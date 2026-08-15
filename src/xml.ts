export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

function decodeEntities(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1]] = decodeEntities(match[2]);
  }
  return attrs;
}

export function parseXml(xml: string): XmlNode {
  const cleaned = xml
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const token = /<!--[\s\S]*?-->|<([A-Za-z_:][\w:.-]*)([^>]*)\/>|<\/([A-Za-z_:][\w:.-]*)>|<(?!\/)([A-Za-z_:][\w:.-]*)([^>]*)>|([^<]+)/g;
  let pos = 0;
  while (pos < cleaned.length) {
    token.lastIndex = pos;
    const match = token.exec(cleaned);
    if (!match || match.index !== pos) {
      throw new Error("unbalanced XML");
    }
    pos += match[0].length;
    const current = stack[stack.length - 1];
    if (match[0].startsWith("<!--")) {
      continue;
    }
    if (match[1]) {
      current.children.push({ name: match[1], attrs: parseAttrs(match[2] ?? ""), children: [], text: "" });
      continue;
    }
    if (match[3]) {
      if (stack.length === 1 || current.name !== match[3]) {
        throw new Error("unbalanced XML");
      }
      stack.pop();
      continue;
    }
    if (match[4]) {
      const node: XmlNode = { name: match[4], attrs: parseAttrs(match[5] ?? ""), children: [], text: "" };
      current.children.push(node);
      stack.push(node);
      continue;
    }
    if (match[6]) {
      if (current === root) {
        if (/\S/.test(match[6])) {
          throw new Error("unbalanced XML");
        }
        continue;
      }
      current.text += decodeEntities(match[6]);
    }
  }
  if (stack.length !== 1) {
    throw new Error("unbalanced XML");
  }
  const elements = root.children.filter((child) => child.name !== "#text");
  if (elements.length !== 1) {
    throw new Error("no root element");
  }
  return elements[0];
}

export function childObjects(node: XmlNode): XmlNode[] {
  return node.children.filter((child) => child.name === "object");
}

export function properties(node: XmlNode): XmlNode[] {
  return node.children.filter((child) => child.name === "property");
}

export function property(node: XmlNode, name: string): XmlNode | undefined {
  return properties(node).find((child) => child.attrs.name === name);
}

export function textOf(node: XmlNode | undefined): string | null {
  if (!node) {
    return null;
  }
  const text = node.text.trim();
  return text.length > 0 ? text : null;
}
