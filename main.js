var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/helpers.js
var require_helpers = __commonJS({
  "src/helpers.js"(exports2, module2) {
    function escapeRegExp(x) {
      return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function splitOptionsWithDefault2(s) {
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
        if (esc) {
          cur += ch;
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === "|") {
          flush();
          continue;
        }
        cur += ch;
      }
      flush();
      return { options, defaultIndex };
    }
    async function readFile(app, file) {
      return await app.vault.read(file);
    }
    async function writeFile(app, file, txt) {
      return await app.vault.modify(file, txt);
    }
    function getFrontmatter2(app, file) {
      return app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    }
    function setFrontmatter(text, key, value) {
      const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
      const kv = `${key}: ${value}`;
      if (!m) return `---
${kv}
---
` + text;
      let body = m[1];
      const reLine = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*.*$`, "m");
      body = reLine.test(body) ? body.replace(reLine, kv) : body + `
${kv}`;
      return `---
${body}
---
` + text.slice(m[0].length);
    }
    function setInlineField(text, key, value, tokenPos = null) {
      const tokenPattern = `\\{${escapeRegExp(key)}\\s*:[^}]+\\}`;
      const inlinePattern = `\\(${escapeRegExp(key)}::[^)]*\\)`;
      const re = new RegExp(`(${tokenPattern})(?:\\s*${inlinePattern})?`, "g");
      if (tokenPos != null) {
        let match;
        while ((match = re.exec(text)) !== null) {
          if (match.index === tokenPos) {
            const before = text.slice(0, match.index);
            const after = text.slice(match.index + match[0].length);
            return before + match[1] + ` (${key}::${value})` + after;
          }
        }
        return text;
      }
      return text.replace(re, (match, token) => {
        return `${token} (${key}::${value})`;
      });
    }
    function setCaretForKey(text, key, selected, tokenPos = null) {
      const tokenRe = new RegExp(`\\{(?<k>${escapeRegExp(key)})\\s*:\\s*(?<opts>[^}]+)\\}`, "g");
      if (tokenPos != null) {
        let match;
        while ((match = tokenRe.exec(text)) !== null) {
          if (match.index === tokenPos) {
            const k = match.groups?.k ?? key;
            const optsRaw = match.groups?.opts ?? "";
            const { options } = splitOptionsWithDefault2(optsRaw);
            if (!options.length) return text;
            const rebuilt = `{${k}: ${options.map((o) => String(o) === String(selected) ? "^" + o : o).join(" | ")}}`;
            return text.slice(0, match.index) + rebuilt + text.slice(match.index + match[0].length);
          }
        }
        return text;
      }
      return text.replace(tokenRe, (match, _k, _opts, _off, _s, groups) => {
        const k = groups?.k ?? key;
        const optsRaw = groups?.opts ?? "";
        const { options } = splitOptionsWithDefault2(optsRaw);
        if (!options.length) return match;
        const rebuilt = `{${k}: ${options.map((o) => String(o) === String(selected) ? "^" + o : o).join(" | ")}}`;
        return rebuilt;
      });
    }
    async function persistSelection2(plugin, file, key, value, tokenPos = null) {
      if (!file) return;
      const raw = await readFile(plugin.app, file);
      let out = raw;
      const { persistFrontmatter, persistInline } = plugin.settings || { persistFrontmatter: true, persistInline: false };
      if (persistFrontmatter) out = setFrontmatter(out, key, value);
      out = setCaretForKey(out, key, value, tokenPos);
      if (persistInline) out = setInlineField(out, key, value, tokenPos);
      if (out !== raw) await writeFile(plugin.app, file, out);
    }
    module2.exports = {
      splitOptionsWithDefault: splitOptionsWithDefault2,
      readFile,
      writeFile,
      getFrontmatter: getFrontmatter2,
      setFrontmatter,
      setInlineField,
      persistSelection: persistSelection2,
      setCaretForKey
    };
  }
});

// src/cm6.js
var require_cm6 = __commonJS({
  "src/cm6.js"(exports2, module2) {
    var { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
    var { RangeSetBuilder } = require("@codemirror/state");
    var {
      splitOptionsWithDefault: splitOptionsWithDefault2,
      getFrontmatter: getFrontmatter2,
      persistSelection: persistSelection2
    } = require_helpers();
    var TOKEN_RE2 = /\{(?<key>[\w\-]+)\s*:\s*(?<opts>[^}]+)\}/g;
    var __dvddOpenMenu2 = null;
    var DropdownWidget = class extends WidgetType {
      constructor(plugin, filePath, key, options, defaultIndex, tokenPos) {
        super();
        this.plugin = plugin;
        this.filePath = filePath;
        this.key = key;
        this.options = options;
        this.defaultIndex = defaultIndex;
        this.tokenPos = tokenPos;
      }
      toDOM(view) {
        const app = this.plugin.app;
        const file = app.vault.getAbstractFileByPath(this.filePath);
        const fm = file ? getFrontmatter2(app, file) : void 0;
        let current = fm?.[this.key];
        if (!current) {
          if (this.defaultIndex != null && this.options[this.defaultIndex] != null) {
            current = this.options[this.defaultIndex];
          } else {
            current = this.options[0] ?? "";
          }
        }
        const root = document.createElement("span");
        root.className = "dvdd";
        const label = document.createElement("span");
        label.className = "dvdd-label";
        const showInlineFormat = this.plugin.settings.persistInline;
        label.textContent = showInlineFormat ? `${this.key} \u25BE` : `${this.key}: ${current} \u25BE`;
        root.appendChild(label);
        const menu = document.createElement("div");
        menu.className = "dvdd-menu";
        menu.style.display = "none";
        const closeMenu = () => {
          if (menu.style.display !== "none") menu.style.display = "none";
          if (__dvddOpenMenu2 === menu) __dvddOpenMenu2 = null;
        };
        const openMenu = () => {
          if (__dvddOpenMenu2 && __dvddOpenMenu2 !== menu) {
            __dvddOpenMenu2.style.display = "none";
          }
          menu.style.display = "block";
          __dvddOpenMenu2 = menu;
        };
        label.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (menu.style.display === "none") openMenu();
          else closeMenu();
          const onDoc = (e) => {
            if (!menu.contains(e.target) && e.target !== label) {
              closeMenu();
              document.removeEventListener("mousedown", onDoc);
            }
          };
          document.addEventListener("mousedown", onDoc);
        });
        for (const opt of this.options) {
          const item = document.createElement("div");
          item.className = "dvdd-item" + (String(opt) === String(current) ? " active" : "");
          item.textContent = opt;
          item.addEventListener("mousedown", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await persistSelection2(this.plugin, file, this.key, opt, this.tokenPos);
            const showInlineFormat2 = this.plugin.settings.persistInline;
            label.textContent = showInlineFormat2 ? `${this.key} \u25BE` : `${this.key}: ${opt} \u25BE`;
            for (const el of menu.querySelectorAll(".dvdd-item")) el.classList.remove("active");
            item.classList.add("active");
            closeMenu();
          });
          menu.appendChild(item);
        }
        root.appendChild(menu);
        return root;
      }
      ignoreEvent() {
        return false;
      }
    };
    function dropdownView2(plugin) {
      return ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view;
          this.wasLivePreview = this.checkLivePreview();
          this.decorations = this.build();
          this.setupModeObserver();
        }
        checkLivePreview() {
          let editorEl = this.view.dom;
          while (editorEl && !editorEl.classList.contains("markdown-source-view")) {
            editorEl = editorEl.parentElement;
          }
          return editorEl?.classList.contains("is-live-preview") ?? true;
        }
        setupModeObserver() {
          let editorEl = this.view.dom;
          while (editorEl && !editorEl.classList.contains("markdown-source-view")) {
            editorEl = editorEl.parentElement;
          }
          if (editorEl) {
            this.observer = new MutationObserver(() => {
              const isNowLivePreview = this.checkLivePreview();
              if (isNowLivePreview !== this.wasLivePreview) {
                this.wasLivePreview = isNowLivePreview;
                this.decorations = this.build();
                this.view.update([]);
              }
            });
            this.observer.observe(editorEl, {
              attributes: true,
              attributeFilter: ["class"]
            });
          }
        }
        destroy() {
          if (this.observer) {
            this.observer.disconnect();
          }
        }
        update(u) {
          const isNowLivePreview = this.checkLivePreview();
          const modeChanged = isNowLivePreview !== this.wasLivePreview;
          this.wasLivePreview = isNowLivePreview;
          if (u.docChanged || u.viewportChanged || u.selectionSet || modeChanged) {
            this.decorations = this.build();
          }
        }
        build() {
          const builder = new RangeSetBuilder();
          const isLivePreview = this.checkLivePreview();
          if (!isLivePreview) return builder.finish();
          const doc = this.view.state.doc;
          const filePath = plugin.app.workspace.getActiveFile()?.path ?? "";
          const cursorPos = this.view.state.selection.main.head;
          for (const vr of this.view.visibleRanges) {
            const text = doc.sliceString(vr.from, vr.to);
            TOKEN_RE2.lastIndex = 0;
            let m;
            while (m = TOKEN_RE2.exec(text)) {
              const idxFrom = vr.from + m.index;
              const idxTo = idxFrom + m[0].length;
              if (cursorPos >= idxFrom && cursorPos <= idxTo) {
                continue;
              }
              const key = m.groups.key;
              const { options, defaultIndex } = splitOptionsWithDefault2(m.groups.opts);
              if (!options.length) continue;
              builder.add(idxFrom, idxTo, Decoration.replace({
                widget: new DropdownWidget(plugin, filePath, key, options, defaultIndex, idxFrom),
                inclusive: false
              }));
            }
          }
          return builder.finish();
        }
      }, { decorations: (v) => v.decorations });
    }
    module2.exports = { dropdownView: dropdownView2 };
  }
});

// src/main.js
var { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");
var { dropdownView } = require_cm6();
var {
  splitOptionsWithDefault,
  getFrontmatter,
  persistSelection
} = require_helpers();
var TOKEN_RE = /\{(?<key>[\w\-]+)\s*:\s*(?<opts>[^}]+)\}/g;
var DEFAULT_SETTINGS = {
  persistFrontmatter: true,
  persistInline: false
  // make sure this is false
};
var DropdownVarsSettingTab = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Dropdown Vars Settings" });
    new Setting(containerEl).setName("Persist to frontmatter").setDesc("Write Key: value into YAML frontmatter.").addToggle((t) => t.setValue(this.plugin.settings.persistFrontmatter).onChange(async (v) => {
      this.plugin.settings.persistFrontmatter = v;
      await this.plugin.saveSettings();
    }));
    new Setting(containerEl).setName("Persist to inline Dataview").setDesc('Place "[Key::value]" right after each dropdown token.').addToggle((t) => t.setValue(this.plugin.settings.persistInline).onChange(async (v) => {
      this.plugin.settings.persistInline = v;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("p", { text: "Syntax: {Key: A | ^B | C} (^ marks default)." });
    containerEl.createEl("p", { text: "Reading: shows \u201CKey:: value\u201D. Live Edit: shows raw token; click to pick." });
  }
};
var __dvddOpenMenu = null;
function createDropdownWidget(plugin, sourcePath, key, options, defaultIndex, occurrenceIndex) {
  const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
  const fm = file ? getFrontmatter(plugin.app, file) : null;
  let current = fm?.[key];
  if (!current) {
    if (defaultIndex != null && options[defaultIndex] != null) current = options[defaultIndex];
    else current = options[0] ?? "";
  }
  const root = document.createElement("span");
  root.className = "dvdd";
  const label = document.createElement("span");
  label.className = "dvdd-label";
  const showInlineFormat = plugin.settings.persistInline;
  label.textContent = showInlineFormat ? `[${key}::${current}] \u25BE` : `${key}: ${current} \u25BE`;
  root.appendChild(label);
  const menu = document.createElement("div");
  menu.className = "dvdd-menu";
  menu.style.display = "none";
  const closeMenu = () => {
    if (menu.style.display !== "none") menu.style.display = "none";
    if (__dvddOpenMenu === menu) __dvddOpenMenu = null;
  };
  const openMenu = () => {
    if (__dvddOpenMenu && __dvddOpenMenu !== menu) {
      __dvddOpenMenu.style.display = "none";
    }
    menu.style.display = "block";
    __dvddOpenMenu = menu;
  };
  const onDocDown = (ev) => {
    if (!menu.contains(ev.target) && ev.target !== label) closeMenu();
  };
  label.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (menu.style.display === "none") {
      openMenu();
      document.addEventListener("mousedown", onDocDown, { once: true });
    } else {
      closeMenu();
    }
  });
  for (const opt of options) {
    const item = document.createElement("div");
    item.className = "dvdd-item" + (String(opt) === String(current) ? " active" : "");
    item.textContent = opt;
    item.addEventListener("mousedown", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const tokenPos = await findTokenPositionByOccurrence(plugin.app, file, key, occurrenceIndex);
      await persistSelection(plugin, file, key, opt, tokenPos);
      const showInlineFormat2 = plugin.settings.persistInline;
      label.textContent = showInlineFormat2 ? `[${key}::${opt}] \u25BE` : `${key}: ${opt} \u25BE`;
      for (const el of menu.querySelectorAll(".dvdd-item")) el.classList.remove("active");
      item.classList.add("active");
      closeMenu();
    });
    menu.appendChild(item);
  }
  root.appendChild(menu);
  return root;
}
async function findTokenPositionByOccurrence(app, file, key, occurrenceIndex) {
  if (!file || occurrenceIndex == null) return null;
  const content = await app.vault.read(file);
  const re = new RegExp(`\\{${key}\\s*:[^}]+\\}`, "g");
  let match;
  let count = 0;
  while ((match = re.exec(content)) !== null) {
    if (count === occurrenceIndex) {
      return match.index;
    }
    count++;
  }
  return null;
}
module.exports = class DropdownVarsPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new DropdownVarsSettingTab(this.app, this));
    this.dropdownCache = /* @__PURE__ */ new Map();
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.injectDropdownMetadata(file);
      })
    );
    this.app.workspace.onLayoutReady(() => {
      this.app.vault.getMarkdownFiles().forEach((file) => {
        this.injectDropdownMetadata(file);
      });
    });
    this.registerMarkdownPostProcessor((root, ctx) => {
      const filePath = ctx.sourcePath;
      if (!filePath) return;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file) return;
      this.extractDropdownValues(file);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while (n = walker.nextNode()) {
        const t = n;
        if (!t.nodeValue) continue;
        TOKEN_RE.lastIndex = 0;
        if (TOKEN_RE.test(t.nodeValue)) nodes.push(t);
      }
      for (const t of nodes) {
        const frag = document.createDocumentFragment();
        const text = t.nodeValue;
        let last = 0, m;
        TOKEN_RE.lastIndex = 0;
        const keyOccurrence = {};
        while (m = TOKEN_RE.exec(text)) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const key = m.groups.key;
          const parsed = splitOptionsWithDefault(m.groups.opts);
          const options = parsed.options;
          const defIdx = parsed.defaultIndex;
          if (!(key in keyOccurrence)) keyOccurrence[key] = 0;
          const occurrenceIndex = keyOccurrence[key]++;
          if (!options.length) {
            frag.appendChild(document.createTextNode(m[0]));
          } else {
            const widget = createDropdownWidget(this, ctx.sourcePath, key, options, defIdx, occurrenceIndex);
            frag.appendChild(widget);
          }
          last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        t.parentNode.replaceChild(frag, t);
      }
    });
    this.registerEditorExtension(dropdownView(this));
  }
  // Inject dropdown values into the metadata cache for Dataview
  async injectDropdownMetadata(file) {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return;
      const content = await this.app.vault.read(file);
      const values = {};
      const fm = cache.frontmatter;
      TOKEN_RE.lastIndex = 0;
      let m;
      while (m = TOKEN_RE.exec(content)) {
        const key = m.groups.key;
        const parsed = splitOptionsWithDefault(m.groups.opts);
        const options = parsed.options;
        const defIdx = parsed.defaultIndex;
        let current = fm?.[key];
        if (!current) {
          if (defIdx != null && options[defIdx] != null) {
            current = options[defIdx];
          } else {
            current = options[0] ?? "";
          }
        }
        values[key] = current;
      }
      this.dropdownCache.set(file.path, values);
      if (!cache.frontmatter) {
        cache.frontmatter = {};
      }
      for (const [key, value] of Object.entries(values)) {
        if (!cache.frontmatter[key]) {
          cache.frontmatter[key] = value;
        }
      }
    } catch (e) {
      console.error("Error injecting dropdown metadata:", e);
    }
  }
  // Extract dropdown values from file content and cache them
  async extractDropdownValues(file) {
    try {
      const content = await this.app.vault.read(file);
      const values = {};
      const fm = getFrontmatter(this.app, file);
      TOKEN_RE.lastIndex = 0;
      let m;
      while (m = TOKEN_RE.exec(content)) {
        const key = m.groups.key;
        const parsed = splitOptionsWithDefault(m.groups.opts);
        const options = parsed.options;
        const defIdx = parsed.defaultIndex;
        let current = fm?.[key];
        if (!current) {
          if (defIdx != null && options[defIdx] != null) {
            current = options[defIdx];
          } else {
            current = options[0] ?? "";
          }
        }
        values[key] = current;
      }
      this.dropdownCache.set(file.path, values);
    } catch (e) {
      console.error("Error extracting dropdown values:", e);
    }
  }
  // Public API: Get dropdown values for a file
  getDropdownValues(filePath) {
    return this.dropdownCache.get(filePath) || {};
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
