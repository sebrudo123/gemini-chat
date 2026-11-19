/**
 * Protocolo de bloques del agente (mismo formato que el CLI).
 *
 *   <tool>{"tool":"read_file","args":{...},"reason":"..."}</tool>
 *   <question>{"header":"...","prompt":"...","options":[...]}</question>
 */

export const ALLOWED_TOOLS = new Set([
  "read_file",
  "write_file",
  "list_dir",
  "run_command",
  "create_dir",
  "delete_path",
]);

const TOOL_RE = /<tool>\s*([\s\S]*?)\s*<\/tool>/g;
const QUESTION_RE = /<question>\s*([\s\S]*?)\s*<\/question>/g;

function parseJson(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function extractTools(text) {
  const tools = [];
  for (const match of String(text || "").matchAll(TOOL_RE)) {
    const data = parseJson(match[1]);
    if (!data) continue;
    const name = String(data.tool || "").trim();
    const args = data.args ?? {};
    if (!ALLOWED_TOOLS.has(name) || typeof args !== "object" || Array.isArray(args)) {
      continue;
    }
    tools.push({
      tool: name,
      args,
      reason: String(data.reason || "").trim(),
    });
  }
  return tools;
}

export function extractQuestions(text) {
  const questions = [];
  for (const match of String(text || "").matchAll(QUESTION_RE)) {
    const data = parseJson(match[1]);
    if (!data) continue;
    const prompt = String(data.prompt || "").trim();
    if (!prompt) continue;
    const options = [];
    for (const option of Array.isArray(data.options) ? data.options.slice(0, 6) : []) {
      if (typeof option === "string" && option.trim()) {
        options.push({ label: option.trim(), description: "" });
      } else if (option && typeof option === "object" && String(option.label || "").trim()) {
        options.push({
          label: String(option.label).trim(),
          description: String(option.description || "").trim(),
        });
      }
    }
    questions.push({
      header: String(data.header || "Pregunta").trim() || "Pregunta",
      prompt,
      options,
    });
  }
  return questions;
}

export function visibleText(text) {
  return String(text || "")
    .replace(TOOL_RE, "")
    .replace(QUESTION_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toolResult(name, ok, output) {
  return `Herramienta: ${name}\nEstado: ${ok ? "ok" : "error"}\nSalida:\n${output}`;
}

export function describeTool(name, args) {
  const path = args?.path ?? "";
  if (name === "read_file") return `Leer el archivo ${path}`;
  if (name === "list_dir") return `Listar la carpeta ${path || "."}`;
  if (name === "write_file") {
    const content = String(args?.content ?? "");
    const preview = content.slice(0, 180).replace(/\n/g, " ");
    return `Escribir ${path} (${content.length} caracteres)\n${preview}`;
  }
  if (name === "create_dir") return `Crear la carpeta ${path}`;
  if (name === "delete_path") return `BORRAR ${path}`;
  if (name === "run_command") return `Ejecutar el comando: ${args?.command ?? ""}`;
  return `${name} ${JSON.stringify(args)}`;
}

export function isDestructive(name) {
  return name !== "read_file" && name !== "list_dir";
}

/**
 * Filtra los bloques mientras llega el streaming para no mostrar JSON crudo.
 * Equivalente a `ui.BlockFilter` del CLI.
 */
export class BlockFilter {
  constructor() {
    this.pending = "";
    this.mode = null;
    this.open = { "<tool>": "tool", "<question>": "question" };
    this.close = { tool: "</tool>", question: "</question>" };
  }

  feed(chunk) {
    this.pending += chunk;
    let out = "";
    for (;;) {
      if (this.mode === null) {
        let best = null;
        for (const [tag, mode] of Object.entries(this.open)) {
          const index = this.pending.indexOf(tag);
          if (index !== -1 && (best === null || index < best.index)) {
            best = { index, tag, mode };
          }
        }
        if (!best) {
          const cut = this.safeCut(this.pending);
          out += this.pending.slice(0, cut);
          this.pending = this.pending.slice(cut);
          break;
        }
        out += this.pending.slice(0, best.index);
        this.pending = this.pending.slice(best.index + best.tag.length);
        this.mode = best.mode;
      } else {
        const close = this.close[this.mode];
        const index = this.pending.indexOf(close);
        if (index === -1) {
          const keep = this.partialTail(this.pending, close);
          this.pending = keep ? this.pending.slice(-keep) : "";
          break;
        }
        this.pending = this.pending.slice(index + close.length);
        this.mode = null;
      }
    }
    return out;
  }

  flush() {
    if (this.mode !== null) {
      this.pending = "";
      return "";
    }
    const value = this.pending;
    this.pending = "";
    return value;
  }

  safeCut(buffer) {
    let best = buffer.length;
    for (const token of [...Object.keys(this.open), ...Object.values(this.close)]) {
      for (let size = 1; size <= Math.min(token.length, buffer.length); size += 1) {
        if (buffer.endsWith(token.slice(0, size))) {
          best = Math.min(best, buffer.length - size);
        }
      }
    }
    return best;
  }

  partialTail(buffer, token) {
    for (let size = Math.min(token.length - 1, buffer.length); size > 0; size -= 1) {
      if (buffer.endsWith(token.slice(0, size))) return size;
    }
    return 0;
  }
}
