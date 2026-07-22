/**
 * codeview — a reusable browse + view experience.
 *
 * Public API: the CodeWorkspace component, the three built-in
 * FileProvider implementations, and a few pure helpers the host may
 * find useful when constructing providers or wiring git.
 *
 * Consumers must also import the stylesheet once:
 *   import 'codeview/dist/codeview.css';
 */
export { default as CodeWorkspace } from './CodeWorkspace';

export { FsaProvider } from './provider/fsa';
export { ServerProvider } from './provider/server';
export { MemoryProvider, createMemoryProvider } from './provider/memory';

export {
  getFileType,
  getCodeLanguage,
  looksBinary,
  formatFileSize,
  sortEntries,
  toTreeNode,
  buildChangeTree,
  isSearchableFile,
  MAX_TEXT_VIEW_SIZE,
} from './provider/shared';
