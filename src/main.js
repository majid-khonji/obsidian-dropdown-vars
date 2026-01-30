const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");
const { dropdownView } = require("./cm6.js");
const {
  splitOptionsWithDefault,
  getFrontmatter,
  persistSelection
} = require("./helpers.js");

const TOKEN_RE = /\{(?<key>[\w\-]+)\s*:\s*(?<opts>[^}]+)\}/g;

const DEFAULT_SETTINGS = {
  persistFrontmatter: true,
  persistInline: false   // make sure this is false
};

// Settings UI
class DropdownVarsSettingTab extends PluginSettingTab {
  constructor(app, plugin){ super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Dropdown Vars Settings" });

    new Setting(containerEl)
      .setName("Persist to frontmatter")
      .setDesc("Write Key: value into YAML frontmatter.")
      .addToggle(t => t.setValue(this.plugin.settings.persistFrontmatter)
        .onChange(async v => { this.plugin.settings.persistFrontmatter = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Persist to inline Dataview")
      .setDesc('Place "[Key::value]" right after each dropdown token.')
      .addToggle(t => t.setValue(this.plugin.settings.persistInline)
        .onChange(async v => { this.plugin.settings.persistInline = v; await this.plugin.saveSettings(); }));

    containerEl.createEl("p", { text: "Syntax: {Key: A | ^B | C} (^ marks default)." });
      containerEl.createEl("p", { text: "Reading: shows “Key:: value”. Live Edit: shows raw token; click to pick." });
  }
}

let __dvddOpenMenu = null; // singleton open menu handle

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
  label.textContent = showInlineFormat ? `[${key}::${current}] ▾` : `${key}: ${current} ▾`;
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
    ev.preventDefault(); ev.stopPropagation();
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
      ev.preventDefault(); ev.stopPropagation();
      // Find the token position in the raw file by searching for the nth occurrence of this key
      const tokenPos = await findTokenPositionByOccurrence(plugin.app, file, key, occurrenceIndex);
      await persistSelection(plugin, file, key, opt, tokenPos);
      const showInlineFormat = plugin.settings.persistInline;
      label.textContent = showInlineFormat ? `[${key}::${opt}] ▾` : `${key}: ${opt} ▾`;
      for (const el of menu.querySelectorAll(".dvdd-item")) el.classList.remove("active");
      item.classList.add("active");
      closeMenu();
    });
    menu.appendChild(item);
  }
  root.appendChild(menu);
  return root;
}

// Find the position of the nth occurrence of a key's token in the file
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

    // Store dropdown values in memory for each file
    this.dropdownCache = new Map(); // filePath -> { key: value }

    // Listen to metadata cache changes to inject dropdown values
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.injectDropdownMetadata(file);
      })
    );

    // Process all existing files on load
    this.app.workspace.onLayoutReady(() => {
      this.app.vault.getMarkdownFiles().forEach(file => {
        this.injectDropdownMetadata(file);
      });
    });

    // Register metadata cache to expose dropdown values to Dataview
    this.registerMarkdownPostProcessor((root, ctx) => {
      const filePath = ctx.sourcePath;
      if (!filePath) return;

      // Extract dropdown values from the content
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file) return;

      this.extractDropdownValues(file);

      // Helper to check if a node is inside a code element
      const isInsideCodeElement = (node) => {
        let parent = node.parentElement;
        while (parent && parent !== root) {
          const tag = parent.tagName.toLowerCase();
          if (tag === 'code' || tag === 'pre') return true;
          parent = parent.parentElement;
        }
        return false;
      };

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) {
        const t = n;
        if (!t.nodeValue) continue;
        // Skip text nodes inside code blocks
        if (isInsideCodeElement(t)) continue;
        TOKEN_RE.lastIndex = 0;
        if (TOKEN_RE.test(t.nodeValue)) nodes.push(t);
      }

      for (const t of nodes) {
        const frag = document.createDocumentFragment();
        const text = t.nodeValue;
        let last = 0, m;
        TOKEN_RE.lastIndex = 0;
        
        // Track occurrence index per key
        const keyOccurrence = {};

        while ((m = TOKEN_RE.exec(text))) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));

          const key = m.groups.key;
          const parsed = splitOptionsWithDefault(m.groups.opts);
          const options = parsed.options;
          const defIdx  = parsed.defaultIndex;
          
          // Track which occurrence of this key we're on
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

  // CM6: Live Preview / Source dropdown behavior
    // @ts-ignore
    this.registerEditorExtension(dropdownView(this));
  }

  // Inject dropdown values into the metadata cache for Dataview
  async injectDropdownMetadata(file) {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return;

      // If inline persistence is enabled, Dataview already reads the inline fields
      // directly from the document. Injecting into frontmatter cache would create
      // duplicates (Dataview would see both the inline field AND our injected value).
      // Only inject if we're NOT using inline fields.
      if (this.settings.persistInline) {
        return;
      }

      const content = await this.app.vault.read(file);
      const values = {};
      const fm = cache.frontmatter;

      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(content))) {
        const key = m.groups.key;
        const parsed = splitOptionsWithDefault(m.groups.opts);
        const options = parsed.options;
        const defIdx = parsed.defaultIndex;

        // Get current value (priority: frontmatter > default > first option)
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

      // Store in our cache
      this.dropdownCache.set(file.path, values);

      // Inject into Obsidian's metadata cache so Dataview can read it
      if (!cache.frontmatter) {
        cache.frontmatter = {};
      }
      
      // Add dropdown values to frontmatter cache (for Dataview compatibility)
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
      while ((m = TOKEN_RE.exec(content))) {
        const key = m.groups.key;
        const parsed = splitOptionsWithDefault(m.groups.opts);
        const options = parsed.options;
        const defIdx = parsed.defaultIndex;

        // Get current value (priority: frontmatter > default > first option)
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

  async saveSettings() { await this.saveData(this.settings); }
};

