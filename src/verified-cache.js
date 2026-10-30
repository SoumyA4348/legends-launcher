const fs = require("fs");
const path = require("path");

const CACHE_FILE = ".legends-verified.json";
const FORMAT = 1;

// Remembers files that already passed a hash or integrity check, keyed by size and
// modification time. Unchanged files are trusted on later launches instead of being read
// again (the game's assets alone are ~800 MB); any re-download, truncation or edit changes
// the key, so that file is fully checked again.
class VerifiedCache {
  constructor(root) {
    this.root = root;
    this.filePath = path.join(root, CACHE_FILE);
    this.entries = new Map();
    this.dirty = false;
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (saved?.format === FORMAT && saved.entries) {
        this.entries = new Map(Object.entries(saved.entries));
      }
    } catch (_error) {
      // missing or corrupt: start empty, everything gets checked once
    }
  }

  // `tag` binds the entry to what the file was checked against (e.g. its expected SHA-1).
  stamp(file, tag) {
    try {
      const stat = fs.statSync(file);
      return `${tag}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    } catch (_error) {
      return null;
    }
  }

  has(file, tag) {
    const stamp = this.stamp(file, tag);
    return stamp !== null && this.entries.get(path.relative(this.root, file)) === stamp;
  }

  add(file, tag) {
    const stamp = this.stamp(file, tag);
    const key = path.relative(this.root, file);
    if (stamp !== null && this.entries.get(key) !== stamp) {
      this.entries.set(key, stamp);
      this.dirty = true;
    }
  }

  save() {
    if (!this.dirty) {
      return;
    }
    const tempPath = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify({ format: FORMAT, entries: Object.fromEntries(this.entries) }));
      fs.renameSync(tempPath, this.filePath);
      this.dirty = false;
    } catch (_error) {
      // not fatal: files are simply checked again next launch
    }
  }
}

module.exports = { VerifiedCache };
