// @ts-check

const { existsSync, readFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { readConfig } = require('./config.cjs');
const { readGitIdentity } = require('./git-state.cjs');
const { createSharedPlanSnapshot } = require('./shared-plan.cjs');
const { uploadSnapshot } = require('./share-upload.cjs');
const { resolvePlanShareTarget } = require('./sharing.cjs');

/** @param {string} repositoryPath */
const hasGitMetadata = (repositoryPath) => {
  let current = resolve(repositoryPath);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return true;
    }
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
};

/**
 * @param {{
 *   codiffVersion: string;
 *   forcePublic?: boolean;
 *   openExternal: (url: string) => Promise<void>;
 *   planFile: string;
 *   repositoryPath: string;
 *   serviceUrlOverride?: string;
 * }} options
 */
const sharePlanFile = async ({
  codiffVersion,
  forcePublic,
  openExternal,
  planFile,
  repositoryPath,
  serviceUrlOverride,
}) => {
  const config = readConfig();
  const uploader = hasGitMetadata(repositoryPath) ? await readGitIdentity(repositoryPath) : {};
  const content = readFileSync(planFile, 'utf8');
  const review = {
    document: {
      id: `plan:${planFile}`,
      path: planFile,
      version: '',
    },
    threads: [],
    version: /** @type {const} */ (1),
  };

  return uploadSnapshot({
    codiffVersion,
    openExternal,
    serviceUrlOverride,
    snapshot: createSharedPlanSnapshot({
      codiffVersion,
      content,
      filePath: planFile,
      review,
      theme: config.settings.theme,
    }),
    target: resolvePlanShareTarget({
      email: uploader.email,
      forcePublic,
      overrideUrl: serviceUrlOverride,
    }),
    uploader,
  });
};

module.exports = {
  sharePlanFile,
};
