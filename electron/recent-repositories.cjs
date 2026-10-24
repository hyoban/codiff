// @ts-check
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

/** @param {string} [directory] */
const createRecentRepositories = (directory = join(homedir(), '.codiff')) => {
  const path = join(directory, 'recent-repositories.json');
  /** @type {Array<string>} */
  let repositories = [];
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(saved)) {
      repositories = [...new Set(saved.filter((item) => typeof item === 'string' && item))].slice(
        0,
        20,
      );
    }
  } catch {
    // A missing or invalid history starts empty.
  }
  return {
    list: () => [...repositories],
    /** @param {string} root */
    remember(root) {
      if (repositories[0] === root) {
        return;
      }
      repositories = [root, ...repositories.filter((path) => path !== root)].slice(0, 20);
      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(path, `${JSON.stringify(repositories, null, 2)}\n`);
      } catch {
        // Project switching still works when history cannot be saved.
      }
    },
  };
};
module.exports = { createRecentRepositories };
