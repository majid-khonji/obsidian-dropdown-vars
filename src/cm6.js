const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");
const {
  splitOptionsWithDefault,
  getFrontmatter,
  persistSelection
} = require("./helpers.js");

const TOKEN_RE = /\{(?<key>[\w\-]+)\s*:\s*(?<opts>[^}]+)\}/g;

let __dvddOpenMenu = null; // singleton across widgets

class DropdownWidget extends WidgetType {
  constructor(plugin, filePath, key, options, defaultIndex, tokenPos) {
    super();
    this.plugin = plugin;
    this.filePath = filePath;
    this.key = key;
    this.options = options;
    this.defaultIndex = defaultIndex;
    this.tokenPos = tokenPos; // character offset in the document
  }

  toDOM(view) {
    const app = this.plugin.app;
    const file = app.vault.getAbstractFileByPath(this.filePath);
    const fm = file ? getFrontmatter(app, file) : undefined;

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

    // Live Preview: show 'Status ▾' if persistInline is enabled
    const label = document.createElement("span");
    label.className = "dvdd-label";
    const showInlineFormat = this.plugin.settings.persistInline;
    label.textContent = showInlineFormat ? `${this.key} ▾` : `${this.key}: ${current} ▾`;
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

    label.addEventListener("mousedown", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (menu.style.display === "none") openMenu(); else closeMenu();
      // close if clicking elsewhere
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
        ev.preventDefault(); ev.stopPropagation();
        await persistSelection(this.plugin, file, this.key, opt, this.tokenPos);
        const showInlineFormat = this.plugin.settings.persistInline;
        label.textContent = showInlineFormat ? `${this.key} ▾` : `${this.key}: ${opt} ▾`;
        for (const el of menu.querySelectorAll(".dvdd-item")) el.classList.remove("active");
        item.classList.add("active");
        closeMenu();
      });
      menu.appendChild(item);
    }

    root.appendChild(menu);
    return root;
  }

  ignoreEvent() { return false; }
}

function dropdownView(plugin) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.wasLivePreview = this.checkLivePreview();
      this.decorations = this.build();
      
      // Set up observer to detect mode changes
      this.setupModeObserver();
    }
    
    checkLivePreview() {
      let editorEl = this.view.dom;
      while (editorEl && !editorEl.classList.contains('markdown-source-view')) {
        editorEl = editorEl.parentElement;
      }
      return editorEl?.classList.contains('is-live-preview') ?? true;
    }
    
    setupModeObserver() {
      let editorEl = this.view.dom;
      while (editorEl && !editorEl.classList.contains('markdown-source-view')) {
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
          attributeFilter: ['class']
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
      
      // Rebuild decorations when document changes, viewport changes, selection changes, OR mode changes
      if (u.docChanged || u.viewportChanged || u.selectionSet || modeChanged) {
        this.decorations = this.build();
      }
    }
    build() {
      const builder = new RangeSetBuilder();

      // Check if we're in Live Preview mode (not strict Source mode)
      const isLivePreview = this.checkLivePreview();
      
      if (!isLivePreview) return builder.finish();

      const doc = this.view.state.doc;
      const filePath = plugin.app.workspace.getActiveFile()?.path ?? "";
      
      // Get cursor position to hide widgets near cursor
      const cursorPos = this.view.state.selection.main.head;

      for (const vr of this.view.visibleRanges) {
        const text = doc.sliceString(vr.from, vr.to);
        TOKEN_RE.lastIndex = 0;
        let m;
        while ((m = TOKEN_RE.exec(text))) {
          const idxFrom = vr.from + m.index;
          const idxTo   = idxFrom + m[0].length;

          // Don't render widget if cursor is within or adjacent to the token
          if (cursorPos >= idxFrom && cursorPos <= idxTo) {
            continue;
          }

          const key = m.groups.key;
          const { options, defaultIndex } = splitOptionsWithDefault(m.groups.opts);
          if (!options.length) continue;

          builder.add(idxFrom, idxTo, Decoration.replace({
            widget: new DropdownWidget(plugin, filePath, key, options, defaultIndex, idxFrom),
            inclusive: false
          }));
        }
      }
      return builder.finish();
    }
  }, { decorations: v => v.decorations });
}

module.exports = { dropdownView };

