/**
 * Renderizador Markdown mínimo y seguro (escapa HTML antes de formatear).
 * No usa dependencias externas para mantener el paquete pequeño.
 */

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(raw) {
  let html = "";
  const parts = String(raw).split(/(`[^`\n]*`)/g);
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      html += `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      continue;
    }
    let text = escapeHtml(part);
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    html += text;
  }
  return html;
}

function renderText(raw) {
  const lines = String(raw).split("\n");
  let html = "";
  let list = null; // "ul" | "ol"

  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    if (/^```/.test(trimmed)) {
      continue;
    }

    if (/^---+\s*$/.test(trimmed)) {
      closeList();
      html += "<hr />";
      continue;
    }

    if (/^#{1,4}\s+/.test(trimmed)) {
      closeList();
      const level = trimmed.match(/^#+/)[0].length;
      const tag = `h${Math.min(level + 1, 5)}`;
      html += `<${tag}>${inline(trimmed.replace(/^#+\s+/, ""))}</${tag}>`;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (list !== "ul") {
        closeList();
        html += "<ul>";
        list = "ul";
      }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      if (list !== "ol") {
        closeList();
        html += "<ol>";
        list = "ol";
      }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      closeList();
      html += `<blockquote>${inline(trimmed.replace(/^>\s?/, ""))}</blockquote>`;
      continue;
    }

    closeList();
    html += `<p>${inline(line)}</p>`;
  }

  closeList();
  return html;
}

export function renderMarkdown(text) {
  const source = String(text ?? "");
  const blocks = [];
  const fence = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let html = "";
  let last = 0;
  let match;

  while ((match = fence.exec(source)) !== null) {
    html += renderText(source.slice(last, match.index));
    const language = match[1] ? ` data-lang="${escapeHtml(match[1])}"` : "";
    html +=
      `<pre class="code"${language}><button class="copy-code" type="button">Copiar</button>` +
      `<code>${escapeHtml(match[2].replace(/\n$/, ""))}</code></pre>`;
    last = fence.lastIndex;
  }

  html += renderText(source.slice(last));
  return html;
}
