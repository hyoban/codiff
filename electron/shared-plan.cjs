// @ts-check

const { basename } = require('node:path');

/** @param {string} value */
const cleanTitle = (value) =>
  value
    .replaceAll(/[*_`[\]]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

/** @param {string} content @param {string} filePath */
const getPlanTitle = (content, filePath) => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  const fileName = basename(filePath).replace(/\.md$/i, '');
  return cleanTitle(heading || fileName || 'Codiff Plan') || 'Codiff Plan';
};

/**
 * @param {{
 *   codiffVersion: string;
 *   content: string;
 *   filePath: string;
 *   review: import('../core/types.ts').PlanReview;
 *   theme: import('../core/types.ts').CodiffTheme;
 * }} options
 */
const createSharedPlanSnapshot = ({ codiffVersion, content, filePath, review, theme }) => ({
  codiffVersion,
  document: {
    content,
    name: basename(filePath),
    title: getPlanTitle(content, filePath),
  },
  exportedAt: new Date().toISOString(),
  kind: /** @type {const} */ ('codiff-plan-share'),
  preferences: { theme },
  review: {
    threads: review.threads,
    version: /** @type {const} */ (1),
  },

  version: /** @type {const} */ (1),
});

module.exports = { createSharedPlanSnapshot };
