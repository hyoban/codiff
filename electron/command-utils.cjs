// @ts-check

const { accessSync, constants, statSync } = require('node:fs');
const { delimiter, join } = require('node:path');

/** @param {string} path */
const isExecutableFile = (path) => {
  try {
    return statSync(path).isFile() && (accessSync(path, constants.X_OK), true);
  } catch {
    return false;
  }
};

/** @param {string} command */
const getExecutableNames = (command) => {
  if (process.platform !== 'win32') {
    return [command];
  }

  const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
};

/** @param {string} command */
const findExecutableOnPath = (command) => {
  const path = process.env.PATH;
  if (!path) {
    return null;
  }

  for (const directory of path.split(delimiter)) {
    if (!directory) {
      continue;
    }

    for (const executable of getExecutableNames(command)) {
      const candidate = join(directory, executable);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

module.exports = { findExecutableOnPath, isExecutableFile };
