# Obsidian Dropdown Vars Plugin

Easily create interactive dropdowns in your notes and optionally sync their values to Dataview inline fields.

## Features
- Dropdowns with syntax: `{Status: A | B | ^C}`
- Click to select a value; caret `^` marks the selected option
- Optionally sync selection to Dataview inline field: `(Status::C)`
- Dropdown renders as `Status ▾` in Live Preview when Dataview sync is enabled
- Only one inline field per dropdown, always updated
- Compatible with Dataview queries: `= this.Status`

## Usage
1. Write a dropdown token in your note:
   ```
   {Status: Todo | ^In Progress | Done}
   ```
2. Enable "Persist to inline Dataview" in plugin settings to sync selection:
   ```
   {Status: Todo | ^In Progress | Done}(Status::In Progress)
   ```
3. Use Dataview inline queries:
   ```
   Status: `= this.Status`
   ```

## Settings
- **Persist to frontmatter**: Save selection to YAML frontmatter
- **Persist to inline Dataview**: Add inline field after dropdown token

## License
MIT
