function escapeRegExp(x){ return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function splitOptionsWithDefault(s) {
  const options = [];
  let defaultIndex = null;

  let cur = "", esc = false;
  const flush = () => {
    const raw = cur.trim();
    if (!raw) return;
    if (raw.startsWith("^")) {
      const val = raw.slice(1).trim();
      options.push(val);
      defaultIndex = options.length - 1;
    } else {
      options.push(raw);
    }
    cur = "";
  };

  for (const ch of s) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === "|") { flush(); continue; }
    cur += ch;
  }
  flush();
  return { options, defaultIndex };
}

async function readFile(app, file) { return await app.vault.read(file); }
async function writeFile(app, file, txt) { return await app.vault.modify(file, txt); }

function getFrontmatter(app, file) {
  return app.metadataCache.getFileCache(file)?.frontmatter ?? null;
}

function setFrontmatter(text, key, value) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const kv = `${key}: ${value}`;
  if (!m) return `---\n${kv}\n---\n` + text;

  let body = m[1];
  const reLine = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*.*$`, "m");
  body = reLine.test(body) ? body.replace(reLine, kv) : body + `\n${kv}`;
  return `---\n${body}\n---\n` + text.slice(m[0].length);
}

function setInlineField(text, key, value) {
  // Format: place inline field right after the dropdown token on the same line
  // Pattern: {Key: ...} becomes {Key: ...} Key: (Key::value)
  const tokenPattern = `\{${escapeRegExp(key)}\s*:[^}]+\}`;
  const inlinePattern = `${escapeRegExp(key)}: \(${escapeRegExp(key)}::[^)]*\)`;

  // Find all occurrences of the token
  const combinedPattern = new RegExp(`(${tokenPattern})\s*${inlinePattern}?`, "g");

  return text.replace(combinedPattern, (match, token) => {
    return `${token} ${key}: (${key}::${value})`;
  });
}

// --- NEW: update the caret in {Key: ...} tokens to mark the selected option ---
function setCaretForKey(text, key, selected) {
  const tokenRe = new RegExp(`\\{(?<k>${escapeRegExp(key)})\\s*:\\s*(?<opts>[^}]+)\\}`, "g");
  return text.replace(tokenRe, (match, _k, _opts, _off, _s, groups) => {
    const k = groups?.k ?? key;
    const optsRaw = groups?.opts ?? "";
    // parse existing options (removes any previous ^)
    const { options } = splitOptionsWithDefault(optsRaw);
    if (!options.length) return match;
    // rebuild with caret on selected
    const rebuilt = `{${k}: ${options.map(o => (String(o) === String(selected) ? "^"+o : o)).join(" | ")}}`;
    return rebuilt;
  });
}

async function persistSelection(plugin, file, key, value) {
  if (!file) return;
  const raw = await readFile(plugin.app, file);
  let out = raw;
  const { persistFrontmatter, persistInline } = plugin.settings || { persistFrontmatter: true, persistInline: false };
  
  if (persistFrontmatter) out = setFrontmatter(out, key, value);
  
  // always sync caret in tokens for Source mode visibility
  out = setCaretForKey(out, key, value);
  
  if (persistInline) out = setInlineField(out, key, value);
  
  if (out !== raw) await writeFile(plugin.app, file, out);
}

module.exports = {
  splitOptionsWithDefault,
  readFile, writeFile,
  getFrontmatter, setFrontmatter, setInlineField,
  persistSelection, setCaretForKey
};

