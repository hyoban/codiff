/**
 * @vitest-environment jsdom
 */

import { CodeView, getHighlighterOptions, preloadHighlighter } from '@pierre/diffs';
import { act, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { useReviewCommentDrafts } from '../app/hooks/useReviewCommentDrafts.ts';
import type { ReviewComment } from '../lib/app-types.ts';
import { workerHighlighterOptions } from '../lib/code-view-options.ts';
import type {
  ChangedFile,
  DefinitionSearchResult,
  PullRequestCodeQualityFinding,
  ReviewSource,
} from '../types.ts';
import { createChangedFile, createChangedFileWithPatch } from './helpers/fixtures.ts';
import { renderReact, setInputValue, waitFor } from './helpers/react.tsx';
import {
  codeViewMock,
  resetCodeViewMock,
  ReviewCodeViewHarness,
  type ReviewDiffBlock,
} from './helpers/review-code-view.tsx';

const markdownEditorMock = vi.hoisted(() => ({
  flush: vi.fn<() => Promise<boolean>>(async () => true),
  heightByAriaLabel: new Map<string, number>(),
  heightReportLimit: Number.POSITIVE_INFINITY,
  heightReports: 0,
  loadingPaths: new Set<string>(),
}));

vi.mock('../app/components/MarkdownDocumentEditor.tsx', async () => {
  const React = await import('react');

  return {
    RepositoryMarkdownEditor: React.forwardRef(function MockRepositoryMarkdownEditor(
      { onHeightChange, path }: { onHeightChange?: (height: number) => void; path: string },
      ref: React.ForwardedRef<{ flush: () => Promise<boolean> }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        flush: markdownEditorMock.flush,
      }));
      const [loading, setLoading] = React.useState(() => markdownEditorMock.loadingPaths.has(path));
      React.useEffect(() => {
        const finishLoading = () => setLoading(markdownEditorMock.loadingPaths.has(path));
        window.addEventListener('markdown-loaded', finishLoading);
        return () => window.removeEventListener('markdown-loaded', finishLoading);
      }, [path]);
      React.useEffect(() => {
        if (!loading) {
          onHeightChange?.(markdownEditorMock.heightByAriaLabel.get(`Edit ${path}`) ?? 100);
        }
      }, [loading, onHeightChange, path]);
      if (loading) {
        return <div className="codiff-markdown-editor-message">Loading…</div>;
      }
      return <div aria-label={`Edit ${path}`}>Markdown editor</div>;
    }),
  };
});

vi.mock('@nkzw/mdx-editor', async () => {
  const React = await import('react');
  type MockEditorProps = {
    ariaLabel?: string;
    className?: string;
    contentClassName?: string;
    onBlur?: () => void;
    onChange?: (value: string) => void;
    onFocus?: () => void;
    onHeightChange?: (height: number) => void;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
    placeholder?: string;
    readOnly?: boolean;
    value?: string;
  };

  return {
    MarkdownEditor: React.forwardRef<
      {
        focus: () => void;
      },
      MockEditorProps
    >((props, ref) => {
      const inputRef = React.useRef<HTMLTextAreaElement>(null);
      const { onHeightChange } = props;
      React.useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
      }));
      React.useEffect(() => {
        if (
          onHeightChange &&
          markdownEditorMock.heightReports < markdownEditorMock.heightReportLimit
        ) {
          markdownEditorMock.heightReports += 1;
          onHeightChange(markdownEditorMock.heightByAriaLabel.get(props.ariaLabel ?? '') ?? 100);
        }
      }, [onHeightChange, props.ariaLabel]);
      return (
        <textarea
          aria-label={props.ariaLabel}
          className={props.contentClassName ?? props.className}
          onBlur={props.onBlur}
          onChange={(event) => props.onChange?.(event.currentTarget.value)}
          onDoubleClick={() => onHeightChange?.(200)}
          onFocus={props.onFocus}
          onKeyDown={(event) =>
            props.onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLDivElement>)
          }
          placeholder={props.placeholder}
          readOnly={props.readOnly}
          ref={inputRef}
          value={props.value}
        />
      );
    }),
  };
});

beforeEach(() => {
  resetCodeViewMock();
  markdownEditorMock.flush.mockClear();
  markdownEditorMock.flush.mockResolvedValue(true);
  markdownEditorMock.heightByAriaLabel.clear();
  markdownEditorMock.heightReportLimit = Number.POSITIVE_INFINITY;
  markdownEditorMock.heightReports = 0;
  markdownEditorMock.loadingPaths.clear();
});

const getCodeViewItemVersion = (id: string) =>
  (codeViewMock.lastItems.find((item) => item.id === id) as { version?: number } | undefined)
    ?.version;

const createLoadedMarkdownFile = (contents: string, fingerprint: string) => {
  const file = createChangedFileWithPatch(
    'plan.md',
    `diff --git a/plan.md b/plan.md\n@@ -1 +1 @@\n-# Original\n+${contents}`,
  );
  return {
    ...file,
    fingerprint,
    sections: file.sections.map((section) => ({
      ...section,
      loadState: 'ready' as const,
      newFile: {
        contents,
        name: file.path,
      },
      oldFile: {
        contents: '# Original\n',
        name: file.path,
      },
    })),
  };
};

const createAddedMarkdownFile = (contents: string, fingerprint: string) => {
  const file = createLoadedMarkdownFile(contents, fingerprint);
  return {
    ...file,
    sections: file.sections.map((section) => ({ ...section, oldFile: undefined })),
    status: 'added' as const,
  };
};

const createCombinedFile = (contents: string, fingerprint: string) => {
  const file = createLoadedMarkdownFile(contents, fingerprint);
  const section = file.sections[0]!;
  return {
    ...file,
    sections: [
      {
        ...section,
        id: 'plan.md:commit',
        kind: 'commit' as const,
        newFile: {
          contents: '# Committed\n',
          name: file.path,
        },
        patch: 'diff --git a/plan.md b/plan.md\n@@ -1 +1 @@\n-# Original\n+# Committed\n',
      },
      {
        ...section,
        id: 'plan.md:unstaged',
        kind: 'unstaged' as const,
        oldFile: {
          contents: '# Committed\n',
          name: file.path,
        },
      },
    ],
  } satisfies ChangedFile;
};

test('generated files are collapsed by default and can be explicitly expanded per review', async () => {
  const file = createChangedFile('src/__generated__/api.ts');
  const reviewKey = 'walkthrough:generated-api';
  const blocks: ReadonlyArray<ReviewDiffBlock> = [
    {
      file,
      id: reviewKey,
      reviewIdentity: {
        fingerprint: file.fingerprint,
        key: reviewKey,
      },
    },
  ];
  await using view = await renderReact(<ReviewCodeViewHarness blocks={blocks} files={[]} />);

  await waitFor(() => {
    expect(
      view.container.querySelector('[aria-label="Expand file"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(view.container.querySelector('.codiff-generated-badge')?.textContent).toBe('Generated');
  });
  await view.rerender(
    <ReviewCodeViewHarness
      blocks={blocks}
      expandedReviewKeys={new Set([reviewKey])}
      files={[]}
      itemVersionByKey={{ [reviewKey]: 1 }}
    />,
  );
  await waitFor(() => {
    expect(
      view.container.querySelector('[aria-label="Collapse file"]')?.getAttribute('aria-expanded'),
    ).toBe('true');
    expect(view.container.querySelector('.codiff-generated-badge')?.textContent).toBe('Generated');
  });
});

test('explicit generated metadata can keep generated-looking paths expanded', async () => {
  const file = {
    ...createChangedFile('src/__generated__/api.ts'),
    generated: false,
  };
  await using view = await renderReact(<ReviewCodeViewHarness files={[file]} />);

  await waitFor(() => {
    expect(
      view.container.querySelector('[aria-label="Collapse file"]')?.getAttribute('aria-expanded'),
    ).toBe('true');
    expect(view.container.querySelector('.codiff-generated-badge')).toBeNull();
  });
});

test.each(['added', 'untracked'] as const)(
  'new %s Markdown opens as a document without change markup',
  async (status) => {
    const file = {
      ...createAddedMarkdownFile('# New document\n', `new-markdown:${status}`),
      status,
    };
    await using view = await renderReact(<ReviewCodeViewHarness files={[file]} />);
    await waitFor(() => {
      expect(view.container.querySelector('[aria-label="Preview plan.md"]')).not.toBeNull();
    });
    expect(view.container.querySelector('.codiff-markdown-diff')).toBeNull();
    expect(view.container.querySelector('[aria-label="Edit plan.md"]:not(button)')).toBeNull();
    expect(
      view.container.querySelector('.codiff-file-header button[aria-label="Edit plan.md"]'),
    ).toBeNull();
  },
);

test('modified Markdown opens as a rendered diff and source anchors navigate to exact old lines', async () => {
  const file = createLoadedMarkdownFile('# Updated\n', 'markdown-source-anchor');
  await using view = await renderReact(<ReviewCodeViewHarness files={[file]} />);
  expect(view.container.querySelector('del')?.textContent).toBe('Original');
  expect(view.container.querySelector('ins')?.textContent).toBe('Updated');
  expect(view.container.querySelector('[aria-label="Edit plan.md"]:not(button)')).toBeNull();
  await act(async () =>
    view.container.querySelector<HTMLButtonElement>('.codiff-markdown-source-anchor')?.click(),
  );
  await waitFor(() => {
    expect(view.container.querySelector('.codiff-markdown-diff')).toBeNull();
    expect(codeViewMock.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'diff:plan.md:unstaged',
        lineNumber: 1,
        side: 'deletions',
        type: 'line',
      }),
    );
  });
});

const createPatchOnlyMarkdownFile = (path: string) => {
  const unloaded = createChangedFileWithPatch(
    path,
    `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-Old paragraph.\n+New paragraph.\n`,
  );
  return {
    file: {
      ...unloaded,
      sections: unloaded.sections.map((section) => ({ ...section, loadState: 'ready' as const })),
    },
    onLoadSectionContents: vi.fn(async () => ({
      newFile: { contents: 'New paragraph.\n', name: path },
      oldFile: { contents: 'Old paragraph.\n', name: path },
    })),
  };
};

test('renderMarkdownAs source opens Markdown as a text diff that toggles to the preview and back', async () => {
  const { file, onLoadSectionContents } = createPatchOnlyMarkdownFile('docs/plain.md');
  await using view = await renderReact(
    <ReviewCodeViewHarness
      files={[file]}
      onLoadSectionContents={onLoadSectionContents}
      renderMarkdownAs="source"
    />,
  );
  const getButton = (title: 'View as Diff' | 'View as Markdown') =>
    view.container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  await waitFor(() => expect(getButton('View as Markdown')).not.toBeNull());

  await act(async () => getButton('View as Markdown')?.click());
  await waitFor(() => expect(view.container.querySelector('ins')?.textContent).toBe('New'));

  await act(async () => getButton('View as Diff')?.click());
  await waitFor(() => expect(getButton('View as Markdown')).not.toBeNull());
});

test('Markdown loads both revisions for patch-only reviews before showing rendered changes', async () => {
  const unloaded = createChangedFileWithPatch(
    'docs/lazy.md',
    'diff --git a/docs/lazy.md b/docs/lazy.md\n@@ -1 +1 @@\n-Old paragraph.\n+New paragraph.\n',
  );
  const file = {
    ...unloaded,
    sections: unloaded.sections.map((section) => ({ ...section, loadState: 'ready' as const })),
  };
  const onLoadSectionContents = vi.fn(async () => ({
    newFile: { contents: 'New paragraph.\n', name: file.path },
    oldFile: { contents: 'Old paragraph.\n', name: file.path },
  }));
  await using view = await renderReact(
    <ReviewCodeViewHarness files={[file]} onLoadSectionContents={onLoadSectionContents} />,
  );
  await waitFor(() => {
    expect(view.container.querySelector('del')?.textContent).toBe('Old');
    expect(view.container.querySelector('ins')?.textContent).toBe('New');
  });
  expect(onLoadSectionContents).toHaveBeenCalledOnce();
});

test('a failed Markdown load is retried once', async () => {
  const { file, onLoadSectionContents } = createPatchOnlyMarkdownFile('docs/retry.md');
  onLoadSectionContents.mockRejectedValueOnce(new Error('Load failed'));
  await using view = await renderReact(
    <ReviewCodeViewHarness files={[file]} onLoadSectionContents={onLoadSectionContents} />,
  );
  await waitFor(() => expect(view.container.querySelector('ins')?.textContent).toBe('New'));
  expect(onLoadSectionContents).toHaveBeenCalledTimes(2);
});

test('a Markdown load that keeps failing is not retried on later renders', async () => {
  const { file, onLoadSectionContents } = createPatchOnlyMarkdownFile('docs/broken.md');
  onLoadSectionContents.mockRejectedValue(new Error('Too large'));
  await using view = await renderReact(
    <ReviewCodeViewHarness files={[file]} onLoadSectionContents={onLoadSectionContents} />,
  );
  await waitFor(() => expect(onLoadSectionContents).toHaveBeenCalledTimes(2));
  await view.rerender(
    <ReviewCodeViewHarness files={[file]} onLoadSectionContents={onLoadSectionContents} />,
  );
  expect(onLoadSectionContents).toHaveBeenCalledTimes(2);
});

test('Markdown sections that cannot load are not fetched', async () => {
  const { file, onLoadSectionContents } = createPatchOnlyMarkdownFile('docs/unloadable.md');
  const unloadable = {
    ...file,
    sections: file.sections.map((section) => ({
      ...section,
      summary: { canLoad: false, reason: 'Codiff could not load full file context.' },
    })),
  };
  await using _view = await renderReact(
    <ReviewCodeViewHarness files={[unloadable]} onLoadSectionContents={onLoadSectionContents} />,
  );
  expect(onLoadSectionContents).not.toHaveBeenCalled();
});

test('Markdown outside the rendered viewport waits to load full revisions', async () => {
  const files = ['first.md', 'later.md'].map((path) => {
    const file = createChangedFile(path);
    return {
      ...file,
      sections: file.sections.map((section) => ({ ...section, loadState: 'ready' as const })),
    };
  });
  const laterItemId = `diff:${files[1].sections[0].id}`;
  codeViewMock.unrenderedItemIds.add(laterItemId);
  const onLoadSectionContents = vi.fn(async (file: ChangedFile) => ({
    newFile: { contents: 'New paragraph.\n', name: file.path },
    oldFile: { contents: 'Old paragraph.\n', name: file.path },
  }));
  const props = { files, onLoadSectionContents };
  await using view = await renderReact(<ReviewCodeViewHarness {...props} />);
  await waitFor(() => expect(view.container.querySelector('ins')?.textContent).toBe('New'));
  expect(onLoadSectionContents.mock.calls.map(([file]) => file.path)).toEqual(['first.md']);

  codeViewMock.unrenderedItemIds.delete(laterItemId);
  await view.rerender(
    <ReviewCodeViewHarness {...props} scrollTarget={{ path: 'later.md', request: 1 }} />,
  );
  await waitFor(() => expect(view.container.querySelectorAll('ins')).toHaveLength(2));
  expect(onLoadSectionContents.mock.calls.map(([file]) => file.path)).toEqual([
    'first.md',
    'later.md',
  ]);
});

test('deleted Markdown shows the removed document', async () => {
  const file = createLoadedMarkdownFile('', 'markdown-deleted');
  await using view = await renderReact(
    <ReviewCodeViewHarness
      files={[
        {
          ...file,
          sections: file.sections.map((section) => ({ ...section, newFile: undefined })),
          status: 'deleted',
        },
      ]}
    />,
  );
  expect(view.container.querySelector('.removed h1')?.textContent).toBe('Original');
  expect(view.container.querySelector('.codiff-markdown-after')).toBeNull();
});

test('Markdown line comments remain visible and deep links open their source lines', async () => {
  const file = createLoadedMarkdownFile('# Changed\n', 'markdown-comment');
  const comment = {
    body: 'Please keep this heading.',
    filePath: file.path,
    id: 'markdown-line-comment',
    isReadOnly: true,
    lineNumber: 1,
    sectionId: file.sections[0].id,
    side: 'additions',
  } satisfies ReviewComment;
  const props = { comments: [comment], files: [file] };
  await using view = await renderReact(<ReviewCodeViewHarness {...props} />);
  expect(view.container.querySelector('.codiff-markdown-diff')).not.toBeNull();
  expect(view.container.textContent).toContain(comment.body);
  await view.rerender(
    <ReviewCodeViewHarness {...props} scrollTarget={{ commentId: comment.id, request: 1 }} />,
  );
  await waitFor(() => {
    expect(view.container.querySelector('.codiff-markdown-diff')).toBeNull();
    expect(codeViewMock.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: 1, side: 'additions', type: 'line' }),
    );
  });
});

test('Markdown search opens source to reveal the matching line', async () => {
  const file = createLoadedMarkdownFile('# Changed\n', 'markdown-search');
  await using view = await renderReact(
    <ReviewCodeViewHarness
      activeSearchMatch={{
        filePath: file.path,
        itemId: `diff:${file.sections[0].id}`,
        lineNumber: 1,
        side: 'deletions',
      }}
      files={[file]}
      searchQuery="Original"
    />,
  );
  await waitFor(() => {
    expect(view.container.querySelector('.codiff-markdown-diff')).toBeNull();
    expect(codeViewMock.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: 1, side: 'deletions', type: 'line' }),
    );
  });
});

test('hunk navigation visits rendered Markdown changes', async () => {
  const file = createLoadedMarkdownFile('# Changed\n', 'markdown-hunks');
  const getRect = HTMLElement.prototype.getBoundingClientRect;
  using _geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-markdown-change')
        ? new DOMRect(0, 300, 900, 100)
        : getRect.call(this);
    });
  await using view = await renderReact(<ReviewCodeViewHarness files={[file]} />);
  codeViewMock.scrollTo.mockClear();
  await view.rerender(
    <ReviewCodeViewHarness files={[file]} hunkNavigation={{ direction: 1, request: 1 }} />,
  );
  expect(codeViewMock.scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ position: expect.any(Number), type: 'position' }),
  );
});

test('later edits to a newly added Markdown file are still shown as diffs', async () => {
  const file = { ...createCombinedFile('# Updated\n', 'new-with-edits'), status: 'added' as const };
  const firstSection = { ...file.sections[0]!, oldFile: undefined };
  await using view = await renderReact(
    <ReviewCodeViewHarness files={[{ ...file, sections: [firstSection, file.sections[1]!] }]} />,
  );
  expect(view.container.querySelectorAll('.codiff-markdown-diff')).toHaveLength(1);
  expect(view.container.querySelector('[aria-label="Preview plan.md"]')).not.toBeNull();
});

test('combined branch-only Markdown sections remain read-only', async () => {
  const loadedFile = createLoadedMarkdownFile('# Committed\n', 'plan.md:commit-only');
  const file = {
    ...loadedFile,
    sections: loadedFile.sections.map((section) => ({
      ...section,
      id: 'plan.md:commit',
      kind: 'commit' as const,
    })),
  } satisfies ChangedFile;
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ReviewCodeViewHarness
        files={[file]}
        source={{
          baseRef: 'base123',
          headRef: 'head123',
          ref: 'main',
          type: 'branch-working-tree',
        }}
      />,
    );
  });
  expect(container.querySelector('[aria-label="Edit plan.md"]:not(button)')).toBeNull();
  expect(container.querySelector('[aria-label="Changes to plan.md"]')).not.toBeNull();
  expect(container.querySelector('.codiff-markdown-review-actions')).toBeNull();
  expect(
    container.querySelector('.codiff-file-header button[aria-label="Edit plan.md"]'),
  ).toBeNull();
  expect(container.querySelector('[aria-label="Edit plan.md"]:not(button)')).toBeNull();
});

test('read-only Markdown previews render additions and deletions', async () => {
  const sectionId = 'README.md:unstaged';
  const file = {
    fingerprint: 'markdown-preview-added-lines',
    path: 'README.md',
    sections: [
      {
        binary: false,
        id: sectionId,
        kind: 'unstaged',
        loadState: 'ready',
        newFile: {
          contents: '# Title\n\nNew paragraph.\n',
          name: 'README.md',
        },
        oldFile: {
          contents: '# Title\n\nOld paragraph.\n',
          name: 'README.md',
        },
        patch: '',
      },
    ],
    status: 'modified',
  } satisfies ChangedFile;

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ReviewCodeViewHarness
        files={[file]}
        initialMarkdownPreviewSectionIds={new Set([sectionId])}
        isReadOnly
      />,
    );
  });
  expect(container.querySelector('[aria-label="Changes to README.md"]')).not.toBeNull();
  expect(container.querySelector('del')?.textContent).toBe('Old');
  expect(container.querySelector('ins')?.textContent).toBe('New');
  expect(container.querySelector('.codiff-markdown-review-actions')).toBeNull();
});

test('scroll selection updates do not publish new item versions', async () => {
  const firstFile = createChangedFile('src/first.ts');
  const secondFile = createChangedFile('README.md');
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ReviewCodeViewHarness files={[firstFile, secondFile]} selectedPath={firstFile.path} />,
    );
  });
  const firstVersions = codeViewMock.lastItems.map((item) => item.version);
  expect(codeViewMock.postRenderNodes[0]?.classList.contains('codiff-selected-item')).toBe(true);
  expect(codeViewMock.postRenderNodes[1]?.classList.contains('codiff-selected-item')).toBe(false);
  await act(async () => {
    root?.render(
      <ReviewCodeViewHarness files={[firstFile, secondFile]} selectedPath={secondFile.path} />,
    );
  });
  expect(codeViewMock.lastItems.map((item) => item.version)).toEqual(firstVersions);
  expect(codeViewMock.postRenderNodes[0]?.classList.contains('codiff-selected-item')).toBe(false);
  expect(codeViewMock.postRenderNodes[1]?.classList.contains('codiff-selected-item')).toBe(true);
});

test('review comment drafts resync clean external updates and reset on comment switch', async () => {
  const file = createChangedFile('src/draft.ts');
  const baseComment = {
    body: 'Original body',
    filePath: file.path,
    id: 'comment-1',
    lineNumber: 1,
    sectionId: file.sections[0].id,
    side: 'additions',
  } satisfies ReviewComment;
  const onUpdateComment = vi.fn();

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;
  const renderComment = (comment: ReviewComment) =>
    root?.render(
      <ReviewCodeViewHarness
        comments={[comment]}
        files={[file]}
        focusCommentId={comment.id}
        onUpdateComment={onUpdateComment}
      />,
    );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    renderComment(baseComment);
  });
  const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(textarea().value).toBe('Original body');
  await act(async () => {
    renderComment({ ...baseComment, body: 'Clean external body' });
  });
  expect(textarea().value).toBe('Clean external body');
  await setInputValue(textarea(), 'Unsaved local draft');
  expect(textarea().value).toBe('Unsaved local draft');
  await act(async () => {
    renderComment({ ...baseComment, body: 'Ignored while dirty' });
  });
  expect(textarea().value).toBe('Unsaved local draft');
  await act(async () => {
    renderComment({
      ...baseComment,
      body: 'Second comment body',
      id: 'comment-2',
    });
  });
  expect(textarea().value).toBe('Second comment body');
});

test('read-only review comments render safe details blocks', async () => {
  const file = createChangedFile('src/review.ts');
  const comment = {
    author: { login: 'ai-reviewer', name: 'AI Code Reviewer' },
    body: '<details>\n<summary>Review rationale</summary>\n\nThis branch needs attention.\n\n</details>',
    filePath: file.path,
    id: 'comment-details',
    isReadOnly: true,
    lineNumber: 1,
    sectionId: file.sections[0].id,
    side: 'additions',
  } satisfies ReviewComment;

  await using view = await renderReact(
    <ReviewCodeViewHarness comments={[comment]} files={[file]} />,
  );

  await waitFor(() => {
    expect(view.container.querySelector('.review-comment-thread details')).not.toBeNull();
  });
  const details = view.container.querySelector<HTMLDetailsElement>(
    '.review-comment-thread details',
  );
  expect(details?.open).toBe(false);
  expect(details?.querySelector('summary')?.textContent).toBe('Review rationale');
  expect(view.container.textContent).toContain('AI Code Reviewer');
});

test('comment scroll targets navigate directly to their diff annotation', async () => {
  const file = createChangedFile('src/deep-link.ts');
  const comment = {
    author: { login: 'reviewer' },
    body: 'Linked review comment.',
    filePath: file.path,
    id: 'gitlab:99',
    isReadOnly: true,
    lineNumber: 1,
    sectionId: file.sections[0].id,
    side: 'additions',
    threadId: 'discussion-1',
  } satisfies ReviewComment;

  await using _view = await renderReact(
    <ReviewCodeViewHarness
      comments={[comment]}
      files={[file]}
      scrollTarget={{ commentId: comment.id, request: 1 }}
    />,
  );

  await waitFor(() => {
    expect(codeViewMock.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `diff:${file.sections[0].id}`,
        lineNumber: 1,
        side: 'additions',
        type: 'line',
      }),
    );
  });
});

test('reload scroll target is retried until the selected item renders', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ReviewCodeViewHarness
        files={[createChangedFile('src/first.ts'), createChangedFile('src/second.ts')]}
        scrollTarget={{ path: 'src/second.ts', request: 1 }}
        selectedPath="src/second.ts"
      />,
    );
  });
  await waitFor(() => {
    expect(codeViewMock.scrollTo).toHaveBeenCalledTimes(1);
  });
  expect(codeViewMock.scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({
      behavior: 'instant',
      id: 'diff:src/second.ts:unstaged',
      type: 'item',
    }),
  );
});

test('scroll targets issue one command per request even before render visibility catches up', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;
  const scrollTarget = {
    behavior: 'smooth' as const,
    path: 'src/second.ts',
    request: 1,
  };

  const renderView = () => (
    <ReviewCodeViewHarness
      files={[createChangedFile('src/first.ts'), createChangedFile('src/second.ts')]}
      scrollTarget={scrollTarget}
    />
  );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(renderView());
  });
  await waitFor(() => {
    expect(codeViewMock.scrollTo).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    root?.render(renderView());
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(codeViewMock.scrollTo).toHaveBeenCalledTimes(1);
});

test('hunk navigation skips stale requests when the review view remounts', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ReviewCodeViewHarness
        diffStyle="unified"
        files={[createChangedFile('src/first.ts')]}
        hunkNavigation={{ direction: 1, request: 1 }}
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(codeViewMock.scrollTo).not.toHaveBeenCalled();
  await act(async () => {
    root?.render(
      <ReviewCodeViewHarness
        diffStyle="unified"
        files={[createChangedFile('src/first.ts')]}
        hunkNavigation={{ direction: 1, request: 2 }}
      />,
    );
  });
  expect(codeViewMock.scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'diff:src/first.ts:unstaged',
      lineNumber: 1,
      side: 'additions',
      type: 'line',
    }),
  );
});

test('hunk navigation skips pull request description source context', async () => {
  const source = {
    description: '## Intent\n\nOrient the reviewer before the diff.',
    number: 12,
    provider: 'github',
    title: 'Review source context',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/12',
  } satisfies ReviewSource;
  const file = createChangedFile('src/first.ts');
  await using app = await renderReact(
    <ReviewCodeViewHarness
      diffStyle="unified"
      files={[file]}
      hunkNavigation={{ direction: 1, request: 1 }}
      source={source}
    />,
  );

  codeViewMock.scrollTo.mockClear();
  await app.rerender(
    <ReviewCodeViewHarness
      diffStyle="unified"
      files={[file]}
      hunkNavigation={{ direction: 1, request: 2 }}
      source={source}
    />,
  );
  const target = codeViewMock.scrollTo.mock.lastCall?.[0];
  expect(target?.id).toBe('diff:src/first.ts:unstaged');
  expect(target).toEqual(
    expect.objectContaining({
      lineNumber: 1,
      side: 'additions',
      type: 'line',
    }),
  );
});

test('markdown preview files survive layout updates in the real virtualized renderer', async () => {
  await preloadHighlighter(getHighlighterOptions('text', workerHighlighterOptions));
  const file = createLoadedMarkdownFile('# Readme\n', 'markdown-layout');
  await using app = await renderReact(<ReviewCodeViewHarness files={[file]} />);
  const root = document.createElement('div');
  root.className = 'code-view';
  document.body.append(root);
  const viewer = new CodeView<unknown>({
    ...workerHighlighterOptions,
    disableErrorHandling: true,
    theme: 'Dunkel',
    themeType: 'dark',
  });
  try {
    viewer.setup(root);
    viewer.setItems(codeViewMock.lastItems);
    viewer.render(true);
    expect(viewer.getRenderedItems()).toHaveLength(1);
    await app.rerender(<ReviewCodeViewHarness collapsed={new Set([file.path])} files={[file]} />);
    expect(codeViewMock.lastItems[0]?.collapsed).toBe(true);
    viewer.setItems(codeViewMock.lastItems);
    expect(() => viewer.render(true)).not.toThrow();
    expect(viewer.getRenderedItems()).toHaveLength(1);
    await app.rerender(<ReviewCodeViewHarness files={[file]} />);
    viewer.setItems(codeViewMock.lastItems);
    expect(() => viewer.render(true)).not.toThrow();

    const updatedFile = createLoadedMarkdownFile('# Updated readme\n', 'markdown-updated');
    await app.rerender(<ReviewCodeViewHarness files={[updatedFile]} />);
    expect(codeViewMock.lastItems[0]?.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({ contents: '# Updated readme\n' }),
        }),
      ]),
    );
    viewer.setItems(codeViewMock.lastItems);
    expect(() => viewer.render(true)).not.toThrow();
    expect(viewer.getRenderedItems()).toHaveLength(1);
  } finally {
    viewer.cleanUp();
    root.remove();
  }
});

test('read-only markdown previews trigger CodeView layout remeasurement after height change', async () => {
  const markdownFile = createAddedMarkdownFile(
    '![diagram](https://example.com/diagram.png)\n',
    'markdown-image-layout',
  );
  const markdownSectionId = 'plan.md:unstaged';
  const source = {
    description: '![flow](https://example.com/flow.png)',
    number: 12,
    provider: 'github',
    title: 'Images in source context',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/12',
  } satisfies ReviewSource;
  await using app = await renderReact(
    <ReviewCodeViewHarness
      files={[markdownFile]}
      initialMarkdownPreviewSectionIds={new Set([markdownSectionId])}
      isReadOnly
      source={source}
    />,
  );

  const markdownItemId = `diff:${markdownSectionId}`;
  const initialMarkdownVersion = getCodeViewItemVersion(markdownItemId);
  const markdownPreview = app.container.querySelector<HTMLElement>(
    '[aria-label="Preview plan.md"]',
  );
  // The source description renders in CodeView's header region, where height
  // changes are observed by the viewer directly instead of item versions.
  const sourceDescription = app.container.querySelector<HTMLElement>(
    '[data-diffs-code-view-header] [aria-label="Preview source description"]',
  );
  expect(markdownPreview).not.toBeNull();
  expect(sourceDescription).not.toBeNull();
  expect(
    sourceDescription?.closest('[data-diffs-code-view-header]')?.closest('[slot="header-custom"]'),
  ).toBeNull();
  await act(async () => {
    markdownPreview?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await waitFor(() => {
    expect(getCodeViewItemVersion(markdownItemId)).not.toBe(initialMarkdownVersion);
  });
  const measuredVersion = getCodeViewItemVersion(markdownItemId);
  await act(async () => {
    markdownPreview?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  expect(getCodeViewItemVersion(markdownItemId)).toBe(measuredVersion);
});

test('recycled Markdown previews retain their measured height during layout-only updates', async () => {
  await preloadHighlighter(getHighlighterOptions('text', workerHighlighterOptions));
  const file = createAddedMarkdownFile('# Long document\n', 'markdown-recycling');
  const props = {
    files: [file],
    initialMarkdownPreviewSectionIds: new Set(['plan.md:unstaged']),
    isReadOnly: true,
  };
  await using app = await renderReact(<ReviewCodeViewHarness {...props} />);

  // jsdom has no layout. Supply the browser measurement of a tall annotation,
  // but use Pierre's real renderer and height cache throughout this test.
  const getRect = HTMLElement.prototype.getBoundingClientRect;
  using _geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-line-annotation')
        ? new DOMRect(0, 0, 900, 5000)
        : getRect.call(this);
    });
  const container = document.createElement('div');
  container.className = 'code-view';
  document.body.append(container);
  const viewer = new CodeView<unknown>({
    ...workerHighlighterOptions,
    disableErrorHandling: true,
    renderAnnotation: () => document.createElement('div'),
    theme: 'Dunkel',
    themeType: 'dark',
  });
  try {
    viewer.setup(container);
    viewer.setItems(codeViewMock.lastItems);
    viewer.render(true);
    const rendered = viewer.getRenderedItems()[0];
    if (rendered?.type !== 'file') {
      throw new Error('Expected a Markdown preview file.');
    }
    const height = rendered.instance.getVirtualizedHeight();
    expect(height).toBeGreaterThan(5000);

    // CodeView recycles the DOM when the document leaves its render window.
    rendered.instance.cleanUp(true);
    await act(async () => {
      app.container
        .querySelector('[aria-label="Preview plan.md"]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const next = codeViewMock.lastItems.find(({ id }) => id === rendered.id);
    if (next?.type !== 'file') {
      throw new Error('Expected the updated preview item.');
    }
    expect(next.version).not.toBe(rendered.version);
    expect(rendered.instance.updateCodeViewLayout(next.file, 0, undefined, next.annotations)).toBe(
      height,
    );
  } finally {
    viewer.cleanUp();
    container.remove();
  }
});

test('source description remains visible when a review has no diff items', async () => {
  const source = {
    description: 'No file changes are needed.',
    number: 13,
    provider: 'github',
    title: 'Empty pull request',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/13',
  } satisfies ReviewSource;
  await using app = await renderReact(
    <ReviewCodeViewHarness files={[]} isReadOnly source={source} />,
  );

  const sourceDescription = app.container.querySelector(
    '[data-diffs-code-view-header] [aria-label="Preview source description"]',
  );
  expect(sourceDescription).not.toBeNull();
  expect(
    sourceDescription?.closest('[data-diffs-code-view-header]')?.closest('[slot="header-custom"]'),
  ).toBeNull();
});

test('hunk navigation orders deletion comments before added rows in unified changes', async () => {
  const file = createChangedFileWithPatch(
    'src/first.ts',
    'diff --git a/src/first.ts b/src/first.ts\n@@ -1 +1 @@\n-old\n+new\n',
  );
  const comment = {
    body: 'Needs work.',
    filePath: 'src/first.ts',
    id: 'comment-1',
    lineNumber: 1,
    sectionId: 'src/first.ts:unstaged',
    side: 'deletions',
  } satisfies ReviewComment;

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  const render = (request: number) =>
    root?.render(
      <ReviewCodeViewHarness
        comments={[comment]}
        diffStyle="unified"
        files={[file]}
        hunkNavigation={{ direction: 1, request }}
      />,
    );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    render(0);
  });
  codeViewMock.scrollTo.mockClear();
  await act(async () => {
    render(1);
  });
  expect(codeViewMock.scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({
      lineNumber: 1,
      side: 'deletions',
      type: 'line',
    }),
  );
  await act(async () => {
    render(2);
  });
  expect(codeViewMock.scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({
      lineNumber: 1,
      side: 'additions',
      type: 'line',
    }),
  );
});

test('review comment typing stays local until a comment action commits it', async () => {
  const file = createChangedFile('src/comment.ts');
  const comment = {
    body: '',
    filePath: file.path,
    id: 'comment-1',
    lineNumber: 1,
    sectionId: 'src/comment.ts:unstaged',
    side: 'additions',
  } satisfies ReviewComment;

  const onCommentDraftChange = vi.fn();
  const onUpdateComment = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ReviewCodeViewHarness
        comments={[comment]}
        diffStyle="unified"
        files={[file]}

        onCommentDraftChange={onCommentDraftChange}
        onUpdateComment={onUpdateComment}
      />,
    );
  });
  const textarea = container.querySelector<HTMLTextAreaElement>('.review-comment-input');
  if (!textarea) {
    throw new Error('Expected review comment textarea.');
  }
  await setInputValue(textarea, 'Please check this.');
  expect(onUpdateComment).not.toHaveBeenCalled();
  expect(onCommentDraftChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: 'Please check this.', id: 'comment-1' }),
  );
  await act(async () => {
    textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  expect(onUpdateComment).toHaveBeenCalledWith('comment-1', 'Please check this.');
});

const renderLocalReviewComment = async ({
  body,

  onCommentDraftChange,
  onCreateComment,
  onDeleteComment,
  onUpdateComment,
}: {
  body: string;

  onCommentDraftChange?: () => void;
  onCreateComment?: () => void;
  onDeleteComment?: () => void;
  onUpdateComment: () => void;
}) => {
  const file = createChangedFile('src/comment.ts');
  const comment = {
    body,
    filePath: file.path,
    id: 'comment-1',
    lineNumber: 1,
    sectionId: file.sections[0].id,
    side: 'additions',
  } satisfies ReviewComment;
  const view = await renderReact(
    <ReviewCodeViewHarness
      comments={[comment]}
      files={[file]}

      onCommentDraftChange={onCommentDraftChange}
      onCreateComment={onCreateComment}
      onDeleteComment={onDeleteComment}
      onUpdateComment={onUpdateComment}
    />,
  );
  const textarea = view.container.querySelector<HTMLTextAreaElement>('.review-comment-input');
  if (!textarea) {
    throw new Error('Expected review comment textarea.');
  }

  textarea.focus();
  return { textarea, view };
};

const pressCommentShortcut = async (textarea: HTMLTextAreaElement, altKey: boolean) => {
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        altKey,
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        metaKey: true,
      }),
    );
  });
};

const dispatchTestPointerEvent = (type: 'pointerdown' | 'pointerup') => {
  const event = new Event(type);
  Object.defineProperty(event, 'pointerId', { value: 1 });
  window.dispatchEvent(event);
};

type StatefulReviewCommentState = ReturnType<typeof useReviewCommentDrafts> & {
  comments: ReadonlyArray<ReviewComment>;
};

const ignoreCommentFileChange = () => {};

function StatefulReviewCommentHarness({
  file,
  initialComment,
  onState,
  onUpdateComment,
}: {
  file: ChangedFile;
  initialComment: ReviewComment;
  onState: (state: StatefulReviewCommentState) => void;
  onUpdateComment: (commentId: string, body: string) => void;
}) {
  const [comments, setComments] = useState<ReadonlyArray<ReviewComment>>([initialComment]);
  const commentState = useReviewCommentDrafts({
    comments,
    onCommentFileChange: ignoreCommentFileChange,
    setComments,
  });
  const updateCommentState = commentState.updateComment;
  const updateComment = useCallback(
    (commentId: string, body: string) => {
      onUpdateComment(commentId, body);
      updateCommentState(commentId, body);
    },
    [onUpdateComment, updateCommentState],
  );
  onState({ ...commentState, comments });

  return (
    <ReviewCodeViewHarness
      comments={comments}
      files={[file]}
      focusCommentId={commentState.focusCommentId}
      focusCommentRequest={commentState.focusCommentRequest}
      onCommentDraftChange={commentState.updateActiveReviewCommentDraft}
      onCreateComment={commentState.createComment}
      onDeleteComment={commentState.deleteComment}
      onUpdateComment={updateComment}
    />
  );
}

test('pointer-driven comment blurs preserve each newly focused editor across repeated moves', async () => {
  vi.useFakeTimers();
  using _timers = {
    [Symbol.dispose]() {
      vi.useRealTimers();
    },
  };
  const randomUUID = vi
    .spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000004');
  using _uuid = {
    [Symbol.dispose]() {
      randomUUID.mockRestore();
    },
  };
  const onUpdateComment = vi.fn();
  const file = createChangedFileWithPatch(
    'src/comment.ts',
    'diff --git a/src/comment.ts b/src/comment.ts\n@@ -1,4 +1,4 @@\n-old one\n-old two\n-old three\n-old four\n+new one\n+new two\n+new three\n+new four\n',
  );
  const initialComment = {
    body: '',
    filePath: file.path,
    id: 'comment-1',
    lineNumber: 1,
    sectionId: file.sections[0].id,
    side: 'additions',
  } satisfies ReviewComment;
  const stateRef: { current: StatefulReviewCommentState | null } = { current: null };
  const getState = () => {
    if (!stateRef.current) {
      throw new Error('Expected review comment state.');
    }
    return stateRef.current;
  };
  const view = await renderReact(
    <StatefulReviewCommentHarness
      file={file}
      initialComment={initialComment}
      onState={(state) => (stateRef.current = state)}
      onUpdateComment={onUpdateComment}
    />,
  );
  await using _view = view;
  const textarea = view.container.querySelector<HTMLTextAreaElement>('.review-comment-input');
  if (!textarea) {
    throw new Error('Expected review comment textarea.');
  }
  await act(async () => textarea.focus());
  await setInputValue(textarea, 'Keep this draft.');
  const lineElement = document.createElement('span');

  const moveFocusedCommentToLine = async (lineNumber: number, expectedCommentId: string) => {
    const focusedEditor = document.activeElement;
    const activeDraftBeforeBlur = getState().activeReviewCommentDraftRef.current;
    const updateCountBeforeBlur = onUpdateComment.mock.calls.length;
    expect(focusedEditor).toBeInstanceOf(HTMLTextAreaElement);

    await act(async () => {
      dispatchTestPointerEvent('pointerdown');
      (focusedEditor as HTMLTextAreaElement).blur();
    });
    expect(getState().activeReviewCommentDraftRef.current).toEqual(activeDraftBeforeBlur);
    expect(onUpdateComment).toHaveBeenCalledTimes(updateCountBeforeBlur);

    const { item, onLineClick } = getReviewCodeViewHandlers();
    await act(async () => {
      dispatchTestPointerEvent('pointerup');
      onLineClick(
        {
          annotationSide: 'additions',
          event: nonInteractivePointerEvent,
          lineElement,
          lineNumber,
        },
        { item },
      );
    });
    expect(onUpdateComment).toHaveBeenCalledTimes(updateCountBeforeBlur);

    const destinationEditor = view.container.querySelector<HTMLTextAreaElement>(
      `[aria-label="Comment on src/comment.ts New line ${lineNumber}"]`,
    );
    expect(document.activeElement).toBe(destinationEditor);
    expect(getState().focusCommentId).toBe(expectedCommentId);
    expect(getState().activeReviewCommentDraftRef.current).toEqual({
      body: '',
      id: expectedCommentId,
    });

    await act(async () => vi.advanceTimersByTime(0));

    // The deferred blur belongs to the previous editor. It must not clear the
    // destination editor's active draft after that editor has received focus.
    expect(getState().activeReviewCommentDraftRef.current).toEqual({
      body: '',
      id: expectedCommentId,
    });
  };

  await moveFocusedCommentToLine(2, '00000000-0000-4000-8000-000000000002');
  expect(onUpdateComment).toHaveBeenCalledOnce();
  expect(onUpdateComment).toHaveBeenCalledWith('comment-1', 'Keep this draft.');
  expect(getState().comments.map(({ body, lineNumber }) => ({ body, lineNumber }))).toEqual([
    { body: 'Keep this draft.', lineNumber: 1 },
    { body: '', lineNumber: 2 },
  ]);

  await moveFocusedCommentToLine(3, '00000000-0000-4000-8000-000000000003');
  expect(getState().comments.map(({ body, lineNumber }) => ({ body, lineNumber }))).toEqual([
    { body: 'Keep this draft.', lineNumber: 1 },
    { body: '', lineNumber: 3 },
  ]);

  await moveFocusedCommentToLine(4, '00000000-0000-4000-8000-000000000004');
  expect(getState().comments.map(({ body, lineNumber }) => ({ body, lineNumber }))).toEqual([
    { body: 'Keep this draft.', lineNumber: 1 },
    { body: '', lineNumber: 4 },
  ]);
  expect(onUpdateComment).toHaveBeenCalledOnce();
});

test('adding an empty local review comment with Mod+Enter discards it', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');

  const onDeleteComment = vi.fn();
  const onUpdateComment = vi.fn();
  const { textarea, view } = await renderLocalReviewComment({
    body: '',

    onDeleteComment,
    onUpdateComment,
  });

  await using _view = view;
  await using _resource = {
    async [Symbol.asyncDispose]() {
      platform.mockRestore();
    },
  };
  await pressCommentShortcut(textarea, false);
  expect(onUpdateComment).not.toHaveBeenCalled();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(onDeleteComment).toHaveBeenCalledTimes(1);
  expect(onDeleteComment).toHaveBeenCalledWith('comment-1');
});

test('file comments can be created for GitLab merge requests but not GitHub pull requests', async () => {
  const file = createChangedFile('src/comment.ts');
  const onCreateComment = vi.fn();
  const gitLabSource = {
    provider: 'gitlab',
    type: 'pull-request',
    url: 'https://gitlab.example.com/group/project/-/merge_requests/1',
  } satisfies ReviewSource;
  const gitHubSource = {
    provider: 'github',
    type: 'pull-request',
    url: 'https://github.com/example/project/pull/1',
  } satisfies ReviewSource;
  await using view = await renderReact(
    <ReviewCodeViewHarness
      files={[file]}
      onCreateComment={onCreateComment}
      source={gitLabSource}
    />,
  );

  const fileCommentButton = view.container.querySelector<HTMLButtonElement>(
    '.codiff-file-comment-button',
  );
  expect(fileCommentButton).not.toBeNull();
  expect(fileCommentButton?.classList.contains('codiff-button')).toBe(true);
  await act(async () => fileCommentButton?.click());
  expect(onCreateComment).toHaveBeenCalledWith({
    anchor: 'file',
    filePath: 'src/comment.ts',
    sectionId: 'src/comment.ts:unstaged',
  });
  await view.rerender(
    <ReviewCodeViewHarness
      files={[file]}
      onCreateComment={onCreateComment}
      source={gitHubSource}
    />,
  );
  expect(view.container.querySelector('.codiff-file-comment-button')).toBeNull();
});

test('file-level review comments render as measured file annotations', async () => {
  const file = createChangedFile('src/comment.ts');
  await using view = await renderReact(
    <ReviewCodeViewHarness
      comments={[
        {
          anchor: 'file',
          author: { login: 'reviewer' },
          body: 'Review this file as a whole.',
          filePath: file.path,
          id: 'gitlab:file',
          isReadOnly: true,
          sectionId: 'src/comment.ts:unstaged',
        },
      ]}
      files={[file]}
      source={{
        provider: 'gitlab',
        type: 'pull-request',
        url: 'https://gitlab.example.com/group/project/-/merge_requests/1',
      }}
    />,
  );

  const fileComments = view.container.querySelector('.review-comment-thread');
  expect(fileComments?.textContent).toContain('Review this file as a whole.');
  expect(fileComments?.closest('.codiff-file-header')).toBeNull();
  const item = codeViewMock.lastItems.find(
    (candidate) => candidate.id === 'diff:src/comment.ts:unstaged',
  ) as
    | {
        annotations?: ReadonlyArray<{
          lineNumber: number;
          metadata: { commentIds?: ReadonlyArray<string>; type: string };
        }>;
      }
    | undefined;
  expect(item?.annotations).toContainEqual({
    lineNumber: 0,
    metadata: {
      commentIds: ['gitlab:file'],
      type: 'review-comment',
    },
    side: 'additions',
  });
});

test('code quality findings render as additions annotations', async () => {
  const file = createChangedFile('src/app.ts');
  const finding = {
    description: 'Avoid an unconditional storage lookup.',
    engineName: 'eslint',
    filePath: file.path,
    fingerprint: 'code-quality-1',
    lineNumber: 1,
    severity: 'major',
    status: 'new',
  } satisfies PullRequestCodeQualityFinding;
  await using view = await renderReact(
    <ReviewCodeViewHarness
      codeQualityFindings={[
        finding,
        { ...finding, fingerprint: 'resolved', status: 'resolved' },
        { ...finding, filePath: 'src/other.ts', fingerprint: 'other-file' },
        { ...finding, fingerprint: 'hidden-line', lineNumber: 99 },
      ]}
      files={[file]}
    />,
  );

  const renderedFinding = view.container.querySelector<HTMLElement>('.code-quality-finding');
  expect(renderedFinding?.dataset.severity).toBe('major');
  expect(renderedFinding?.dataset.status).toBe('new');
  expect(renderedFinding?.textContent).toContain('Code Quality');
  expect(renderedFinding?.textContent).toContain('Major');
  expect(renderedFinding?.textContent).toContain('New');
  expect(renderedFinding?.textContent).toContain(finding.description);
  expect(renderedFinding?.textContent).toContain('eslint');
  const item = codeViewMock.lastItems.find(
    (candidate) => candidate.id === 'diff:src/app.ts:unstaged',
  ) as
    | {
        annotations?: ReadonlyArray<{
          lineNumber: number;
          metadata: { finding?: PullRequestCodeQualityFinding; type: string };
          side: string;
        }>;
      }
    | undefined;
  expect(item?.annotations?.filter(({ metadata }) => metadata.type === 'code-quality')).toEqual([
    {
      lineNumber: 1,
      metadata: {
        finding,
        type: 'code-quality',
      },
      side: 'additions',
    },
  ]);
});

test('Enter on a focused review control is not converted into a hunk comment', async () => {
  const onCreateComment = vi.fn();
  const onOpenFile = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  const render = (request: number) =>
    root?.render(
      <ReviewCodeViewHarness
        diffStyle="unified"
        files={[createChangedFile('src/first.ts')]}
        hunkNavigation={{ direction: 1, request }}
        onCreateComment={onCreateComment}
        onOpenFile={onOpenFile}
      />,
    );

  await using _resource = {
    async [Symbol.asyncDispose]() {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    render(0);
  });
  await act(async () => {
    render(1);
  });
  const openButton = container.querySelector<HTMLButtonElement>('.codiff-open-file-button');
  if (!openButton) {
    throw new Error('Expected the open file button.');
  }
  openButton.focus();
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
  });
  openButton.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(onCreateComment).not.toHaveBeenCalled();
});

type ReviewLineClickHandler = (
  line: {
    annotationSide: 'additions' | 'deletions';
    event: unknown;
    lineElement?: HTMLElement;
    lineNumber: number;
  },
  context: { item: unknown },
) => void;

type ReviewLineRangeHandler = (
  range: { end: number; side: 'additions' | 'deletions'; start: number },
  context: { item: unknown },
) => void;

const getReviewCodeViewHandlers = () => {
  const options = codeViewMock.lastOptions;
  const item = codeViewMock.lastItems.find((candidate) => candidate.type === 'diff');
  if (!options || !item) {
    throw new Error('Expected CodeView options and a diff item.');
  }

  return {
    item,
    onGutterUtilityClick: options.onGutterUtilityClick as unknown as ReviewLineRangeHandler,
    onLineClick: options.onLineClick as unknown as ReviewLineClickHandler,
    onLineSelectionEnd: options.onLineSelectionEnd as unknown as ReviewLineRangeHandler,
  };
};

const nonInteractivePointerEvent = { composedPath: () => [] };

test('modifier-clicking an identifier finds and opens its definition without commenting', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
  const onCreateComment = vi.fn();
  const onFindDefinitions = vi.fn(async () => ({
    candidates: [
      {
        canOpenInEditor: true,
        kind: 'function',
        line: 'export function formatGreeting() {}',
        lineNumber: 1,
        path: 'src/greeting.ts',
        side: 'additions' as const,
      },
    ],
    identifier: 'formatGreeting',
    status: 'ready' as const,
  }));
  const onOpenDefinition = vi.fn();
  const file = createChangedFileWithPatch(
    'src/main.ts',
    'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old()\n+formatGreeting()\n',
  );
  const lineElement = document.createElement('div');
  const token = document.createElement('span');
  token.textContent = 'formatGreeting';
  lineElement.append(token, '()');
  await using _view = await renderReact(
    <ReviewCodeViewHarness
      files={[file]}
      onCreateComment={onCreateComment}
      onFindDefinitions={onFindDefinitions}
      onOpenDefinition={onOpenDefinition}
    />,
  );
  await using _platform = {
    [Symbol.dispose]() {
      platform.mockRestore();
    },
  };
  const { item, onLineClick } = getReviewCodeViewHandlers();

  await act(async () => {
    onLineClick(
      {
        annotationSide: 'additions',
        event: {
          clientX: 120,
          clientY: 80,
          composedPath: () => [],
          ctrlKey: true,
          metaKey: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          target: token,
        },
        lineElement,
        lineNumber: 1,
      },
      { item },
    );
  });

  await waitFor(() => {
    expect(document.querySelector('.definition-popover-result')).not.toBeNull();
  });
  expect(onFindDefinitions).toHaveBeenCalledWith({
    identifier: 'formatGreeting',
    kind: 'unstaged',
    lineNumber: 1,
    path: 'src/main.ts',
    side: 'additions',
    source: { type: 'working-tree' },
  });
  expect(onCreateComment).not.toHaveBeenCalled();

  await act(async () => {
    document.querySelector<HTMLButtonElement>('.definition-popover-result')?.click();
  });
  expect(onOpenDefinition).toHaveBeenCalledWith(
    expect.objectContaining({ lineNumber: 1, path: 'src/greeting.ts' }),
  );
});

test('macOS Control-click keeps the context-menu gesture instead of finding a definition', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
  const onFindDefinitions = vi.fn();
  const file = createChangedFileWithPatch(
    'src/main.ts',
    'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old()\n+formatGreeting()\n',
  );
  const lineElement = document.createElement('div');
  const token = document.createElement('span');
  token.textContent = 'formatGreeting';
  lineElement.append(token, '()');
  await using _view = await renderReact(
    <ReviewCodeViewHarness files={[file]} onFindDefinitions={onFindDefinitions} />,
  );
  await using _platform = {
    [Symbol.dispose]() {
      platform.mockRestore();
    },
  };
  const { item, onLineClick } = getReviewCodeViewHandlers();
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();

  await act(async () => {
    onLineClick(
      {
        annotationSide: 'additions',
        event: {
          clientX: 120,
          clientY: 80,
          composedPath: () => [],
          ctrlKey: true,
          metaKey: false,
          preventDefault,
          stopPropagation,
          target: token,
        },
        lineElement,
        lineNumber: 1,
      },
      { item },
    );
  });

  expect(onFindDefinitions).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(stopPropagation).not.toHaveBeenCalled();
});

test('definition results inside the rendered diff jump in Codiff instead of opening an editor', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
  const onFindDefinitions = vi.fn(async () => ({
    candidates: [
      {
        canOpenInEditor: false,
        kind: 'function',
        line: 'function formatGreeting() {}',
        lineNumber: 1,
        path: 'src/main.ts',
        side: 'additions' as const,
      },
    ],
    identifier: 'formatGreeting',
    status: 'ready' as const,
  }));
  const onOpenDefinition = vi.fn();
  const file = createChangedFileWithPatch(
    'src/main.ts',
    'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old()\n+formatGreeting()\n',
  );
  const lineElement = document.createElement('div');
  const token = document.createElement('span');
  token.textContent = 'formatGreeting';
  lineElement.append(token, '()');
  await using _view = await renderReact(
    <ReviewCodeViewHarness
      files={[file]}
      onFindDefinitions={onFindDefinitions}
      onOpenDefinition={onOpenDefinition}
    />,
  );
  await using _platform = {
    [Symbol.dispose]() {
      platform.mockRestore();
    },
  };
  const { item, onLineClick } = getReviewCodeViewHandlers();

  await act(async () => {
    onLineClick(
      {
        annotationSide: 'additions',
        event: {
          clientX: 120,
          clientY: 80,
          composedPath: () => [],
          ctrlKey: false,
          metaKey: true,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          target: token,
        },
        lineElement,
        lineNumber: 1,
      },
      { item },
    );
  });

  await waitFor(() => {
    expect(document.querySelector('.definition-popover-result')).not.toBeNull();
  });
  expect(document.querySelector('[aria-label="Jump within diff"]')).not.toBeNull();

  await act(async () => {
    document.querySelector<HTMLButtonElement>('.definition-popover-result')?.click();
  });
  expect(codeViewMock.scrollTo).toHaveBeenCalledWith({
    align: 'center',
    behavior: 'smooth-auto',
    id: item.id,
    lineNumber: 1,
    offset: 11,
    side: 'additions',
    type: 'line',
  });
  expect(onOpenDefinition).not.toHaveBeenCalled();
});

test('historical definitions outside the diff do not open the current checkout', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
  const onFindDefinitions = vi.fn(async () => ({
    candidates: [
      {
        canOpenInEditor: false,
        kind: 'function',
        line: 'function formatGreeting() {}',
        lineNumber: 20,
        path: 'src/greeting.ts',
        side: 'additions' as const,
      },
    ],
    identifier: 'formatGreeting',
    status: 'ready' as const,
  }));
  const onOpenDefinition = vi.fn();
  const file = createChangedFile('src/main.ts', {
    kind: 'commit',
    patch: 'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old()\n+formatGreeting()\n',
  });
  const lineElement = document.createElement('div');
  const token = document.createElement('span');
  token.textContent = 'formatGreeting';
  lineElement.append(token, '()');
  await using _view = await renderReact(
    <ReviewCodeViewHarness
      files={[file]}
      onFindDefinitions={onFindDefinitions}
      onOpenDefinition={onOpenDefinition}
      source={{ ref: 'abcdef0', type: 'commit' }}
    />,
  );
  await using _platform = {
    [Symbol.dispose]() {
      platform.mockRestore();
    },
  };
  const { item, onLineClick } = getReviewCodeViewHandlers();

  await act(async () => {
    onLineClick(
      {
        annotationSide: 'additions',
        event: {
          clientX: 120,
          clientY: 80,
          composedPath: () => [],
          ctrlKey: false,
          metaKey: true,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          target: token,
        },
        lineElement,
        lineNumber: 1,
      },
      { item },
    );
  });

  await waitFor(() => {
    expect(document.querySelector('.definition-popover-result')).not.toBeNull();
  });
  const result = document.querySelector<HTMLButtonElement>('.definition-popover-result');
  expect(result?.disabled).toBe(true);
  expect(
    document.querySelector('[aria-label="Unavailable outside this historical diff"]'),
  ).not.toBeNull();
  await act(async () => result?.click());
  expect(onOpenDefinition).not.toHaveBeenCalled();
});

test('definition search rejection becomes an unavailable result', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
  const onFindDefinitions = vi.fn(async () => {
    throw new Error('IPC unavailable');
  });
  const file = createChangedFileWithPatch(
    'src/main.ts',
    'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old()\n+formatGreeting()\n',
  );
  const lineElement = document.createElement('div');
  const token = document.createElement('span');
  token.textContent = 'formatGreeting';
  lineElement.append(token, '()');
  await using _view = await renderReact(
    <ReviewCodeViewHarness
      files={[file]}
      onFindDefinitions={onFindDefinitions}
      onOpenDefinition={() => {}}
    />,
  );
  await using _platform = {
    [Symbol.dispose]() {
      platform.mockRestore();
    },
  };
  const { item, onLineClick } = getReviewCodeViewHandlers();

  await act(async () => {
    onLineClick(
      {
        annotationSide: 'additions',
        event: {
          clientX: 120,
          clientY: 80,
          composedPath: () => [],
          ctrlKey: true,
          metaKey: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          target: token,
        },
        lineElement,
        lineNumber: 1,
      },
      { item },
    );
  });

  await waitFor(() => {
    expect(document.querySelector('.definition-popover-message')?.textContent).toBe(
      'Definition search is unavailable for this repository.',
    );
  });
});

test('definition result is invalidated when the review source changes', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32');
  let resolveSearch: ((result: DefinitionSearchResult) => void) | undefined;
  const onFindDefinitions = vi.fn(
    () =>
      new Promise<DefinitionSearchResult>((resolve) => {
        resolveSearch = resolve;
      }),
  );
  const file = createChangedFileWithPatch(
    'src/main.ts',
    'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old()\n+formatGreeting()\n',
  );
  const lineElement = document.createElement('div');
  const token = document.createElement('span');
  token.textContent = 'formatGreeting';
  lineElement.append(token, '()');
  await using view = await renderReact(
    <ReviewCodeViewHarness
      files={[file]}
      onFindDefinitions={onFindDefinitions}
      onOpenDefinition={() => {}}
    />,
  );
  await using _platform = {
    [Symbol.dispose]() {
      platform.mockRestore();
    },
  };
  const { item, onLineClick } = getReviewCodeViewHandlers();

  await act(async () => {
    onLineClick(
      {
        annotationSide: 'additions',
        event: {
          clientX: 120,
          clientY: 80,
          composedPath: () => [],
          ctrlKey: true,
          metaKey: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          target: token,
        },
        lineElement,
        lineNumber: 1,
      },
      { item },
    );
  });
  expect(document.querySelector('.definition-popover')).not.toBeNull();

  await view.rerender(
    <ReviewCodeViewHarness
      files={[createChangedFile('src/next.ts', { kind: 'commit' })]}
      onFindDefinitions={onFindDefinitions}
      onOpenDefinition={() => {}}
      source={{ ref: 'abcdef0', type: 'commit' }}
    />,
  );
  await act(async () => {
    resolveSearch?.({ candidates: [], identifier: 'formatGreeting', status: 'ready' });
  });
  expect(document.querySelector('.definition-popover')).toBeNull();
});

test('modifier navigation follows file hosts reused by CodeView virtualization', async () => {
  const platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
  const onFindDefinitions = vi.fn(async () => ({
    candidates: [],
    identifier: 'formatGreeting',
    status: 'ready' as const,
  }));
  const file = createChangedFileWithPatch(
    'src/main.ts',
    'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old()\n+formatGreeting()\n',
  );
  await using _view = await renderReact(
    <ReviewCodeViewHarness files={[file]} onFindDefinitions={onFindDefinitions} />,
  );
  await using _platform = {
    [Symbol.dispose]() {
      platform.mockRestore();
    },
  };
  const { item } = getReviewCodeViewHandlers();
  const onPostRender = codeViewMock.lastOptions?.onPostRender as
    | ((
        node: HTMLElement,
        instance: unknown,
        phase: 'update',
        context: { item: typeof item },
      ) => void)
    | undefined;
  const host = document.createElement('diffs-container');
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  document.body.append(host);

  await using _host = {
    [Symbol.dispose]() {
      host.remove();
    },
  };
  const renderLine = (identifier: string) => {
    const line = document.createElement('div');
    line.dataset.line = '1';
    line.textContent = `${identifier}();`;
    root.replaceChildren(line);
    onPostRender?.(host, {}, 'update', { item });
  };

  await act(async () => {
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, metaKey: true }));
    renderLine('firstFileSymbol');
  });
  await waitFor(() => {
    expect(root.querySelector('[data-codiff-identifier]')?.textContent).toBe('firstFileSymbol');
  });

  await act(async () => renderLine('newlyVirtualizedFileSymbol'));
  await waitFor(() => {
    expect(root.querySelector('[data-codiff-identifier]')?.textContent).toBe(
      'newlyVirtualizedFileSymbol',
    );
  });
});

const renderIdentifierNavigationView = async () => {
  const view = await renderReact(
    <ReviewCodeViewHarness
      files={[createChangedFile('src/main.ts')]}
      onFindDefinitions={async ({ identifier }) => ({
        candidates: [],
        identifier,
        status: 'ready',
      })}
    />,
  );
  const { item } = getReviewCodeViewHandlers();
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const line = document.createElement('div');
  line.dataset.line = '1';
  line.textContent = 'formatGreeting(name);';
  root.append(line);
  view.container.append(host);
  codeViewMock.renderedElements.set(item.id, host);
  const onPostRender = codeViewMock.lastOptions?.onPostRender as (
    node: HTMLElement,
    instance: unknown,
    phase: 'update',
    context: { item: typeof item },
  ) => void;

  return {
    ...view,
    flushHighlights: async () => {
      await act(async () => {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      });
    },
    host,
    line,
    postRender: () => onPostRender(host, {}, 'update', { item }),
    root,
  };
};

test.each(['MacIntel', 'Win32'])(
  'modifier highlights preserve text selected before deferred updates and during copy on %s',
  async (platform) => {
    using _platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
    await using view = await renderIdentifierNavigationView();
    const isMac = platform === 'MacIntel';
    const modifier = { ctrlKey: !isMac, metaKey: isMac };
    const modifierKey = isMac ? 'Meta' : 'Control';
    const text = view.line.firstChild!;
    const range = document.createRange();
    const collapsedRange = document.createRange();
    using _selection = vi.spyOn(window, 'getSelection').mockReturnValue({
      getComposedRanges: () => [range],
      getRangeAt: () => collapsedRange,
      isCollapsed: true,
      rangeCount: 1,
      toString: () => '',
    } as unknown as Selection);

    // Selection starts after keydown but before either scheduled highlight path.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: modifierKey, ...modifier }));
    view.postRender();
    range.setStart(text, 0);
    range.setEnd(text, 14);
    await view.flushHighlights();
    expect(view.host.hasAttribute('data-codiff-definition-mode')).toBe(false);
    expect(view.root.querySelector('[data-codiff-identifier]')).toBeNull();
    expect(range.toString()).toBe('formatGreeting');
    expect(text.isConnected).toBe(true);

    for (const type of ['keydown', 'keyup']) {
      const event = new KeyboardEvent(type, { cancelable: true, key: 'c', ...modifier });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { key: modifierKey }));
    expect(range.toString()).toBe('formatGreeting');

    // Pressing the modifier with an existing selection is also harmless.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: modifierKey, ...modifier }));
    await view.flushHighlights();
    expect(view.host.hasAttribute('data-codiff-definition-mode')).toBe(false);
    expect(range.toString()).toBe('formatGreeting');

    // Clearing selection restores highlights without requiring another keypress.
    range.collapse();
    document.dispatchEvent(new Event('selectionchange'));
    await view.flushHighlights();
    expect(view.host.hasAttribute('data-codiff-definition-mode')).toBe(true);
    const identifierText = view.root.querySelector('[data-codiff-identifier]')!.firstChild!;
    range.selectNodeContents(identifierText);
    document.dispatchEvent(new Event('selectionchange'));
    await view.flushHighlights();
    expect(view.host.hasAttribute('data-codiff-definition-mode')).toBe(false);
    expect(range.toString()).toBe('formatGreeting');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: modifierKey }));
    expect(range.toString()).toBe('formatGreeting');
    expect(range.startContainer).toBe(identifierText);
    expect(identifierText.isConnected).toBe(true);
  },
);

test('pointer selection cancels pending modifier highlights and resumes after release', async () => {
  using _platform = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
  await using view = await renderIdentifierNavigationView();
  const text = view.line.firstChild;

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
  view.postRender();
  window.dispatchEvent(new MouseEvent('pointerdown', { buttons: 1, metaKey: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
  window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1, metaKey: true }));
  view.postRender();
  await view.flushHighlights();
  expect(view.host.hasAttribute('data-codiff-definition-mode')).toBe(false);
  expect(view.root.querySelector('[data-codiff-identifier]')).toBeNull();
  expect(view.line.firstChild).toBe(text);

  window.dispatchEvent(new MouseEvent('pointerup', { buttons: 0, metaKey: true }));
  await view.flushHighlights();
  expect(view.host.hasAttribute('data-codiff-definition-mode')).toBe(true);
  expect(view.root.querySelector('[data-codiff-identifier]')?.textContent).toBe('formatGreeting');

  // Losing pointer capture or window focus must not leave dragging latched.
  for (const resetEvent of ['pointercancel', 'blur']) {
    window.dispatchEvent(new MouseEvent('pointerdown', { buttons: 1, metaKey: true }));
    window.dispatchEvent(new Event(resetEvent));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    await view.flushHighlights();
    expect(view.host.hasAttribute('data-codiff-definition-mode')).toBe(true);
  }
});

test('line content clicks only ignore text selected on the clicked line', async () => {
  const onCreateComment = vi.fn();
  const file = createChangedFileWithPatch(
    'src/click.ts',
    'diff --git a/src/click.ts b/src/click.ts\n@@ -1,2 +1,2 @@\n-old one\n-old two\n+new one\n+new two\n',
  );
  const container = document.createElement('div');
  const shadowHost = document.createElement('div');
  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
  const lineElement = document.createElement('span');
  const lineText = document.createTextNode('selected code');
  lineElement.append(lineText);
  const otherLineElement = document.createElement('span');
  otherLineElement.textContent = 'other code';
  shadowRoot.append(lineElement, otherLineElement);
  document.body.append(container, shadowHost);
  let root: Root | null = null;

  await using _resource = {
    async [Symbol.asyncDispose]() {
      window.getSelection()?.removeAllRanges();
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
      shadowHost.remove();
    },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<ReviewCodeViewHarness files={[file]} onCreateComment={onCreateComment} />);
  });
  const { item, onGutterUtilityClick, onLineClick, onLineSelectionEnd } =
    getReviewCodeViewHandlers();
  const range = { end: 1, side: 'additions' as const, start: 1 };
  await act(async () => {
    onLineClick(
      {
        annotationSide: 'additions',
        event: nonInteractivePointerEvent,
        lineElement,
        lineNumber: 1,
      },
      { item },
    );
  });
  expect(onCreateComment).toHaveBeenCalledTimes(1);
  expect(onCreateComment).toHaveBeenLastCalledWith({
    filePath: 'src/click.ts',
    lineNumber: 1,
    sectionId: 'src/click.ts:unstaged',
    side: 'additions',
  });

  const getComposedRanges = vi.fn(() => [
    {
      collapsed: false,
      endContainer: lineText,
      endOffset: lineText.length,
      startContainer: lineText,
      startOffset: 0,
    } as StaticRange,
  ]);
  const selectedRange = document.createRange();
  selectedRange.selectNodeContents(lineElement);
  {
    using _selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      getComposedRanges,
      getRangeAt: () => selectedRange,
      isCollapsed: true,
      rangeCount: 1,
      toString: () => '',
    } as unknown as Selection);

    await act(async () => {
      onLineClick(
        {
          annotationSide: 'additions',
          event: nonInteractivePointerEvent,
          lineElement,
          lineNumber: 1,
        },
        { item },
      );
    });
    expect(getComposedRanges).toHaveBeenCalledWith({ shadowRoots: [shadowRoot] });
    expect(onCreateComment).toHaveBeenCalledTimes(1);

    await act(async () => {
      onLineClick(
        {
          annotationSide: 'additions',
          event: nonInteractivePointerEvent,
          lineElement: otherLineElement,
          lineNumber: 2,
        },
        { item },
      );
    });
    expect(onCreateComment).toHaveBeenCalledTimes(2);
    expect(onCreateComment).toHaveBeenLastCalledWith({
      filePath: 'src/click.ts',
      lineNumber: 2,
      sectionId: 'src/click.ts:unstaged',
      side: 'additions',
    });
  }

  await act(async () => {
    onLineSelectionEnd(range, { item });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(onCreateComment).toHaveBeenCalledTimes(3);
  expect(onCreateComment).toHaveBeenLastCalledWith({
    filePath: 'src/click.ts',
    lineNumber: 1,
    sectionId: 'src/click.ts:unstaged',
    side: 'additions',
  });
  await act(async () => {
    onGutterUtilityClick(range, { item });
    // The pointer-up after a gutter drag also ends a line selection; only
    // the gutter callback may create the comment.
    onLineSelectionEnd(range, { item });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(onCreateComment).toHaveBeenCalledTimes(4);
});
