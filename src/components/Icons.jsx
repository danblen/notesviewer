/**
 * Minimal SVG icons — no external dependency.
 */

export function FolderIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M1.5 4.2c0-.4.3-.7.7-.7h3.1c.2 0 .4.1.5.2l1.1 1.1h6.9c.4 0 .7.3.7.7v7.6c0 .4-.3.7-.7.7H2.2c-.4 0-.7-.3-.7-.7V4.2z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.08"
      />
    </svg>
  );
}

export function FileIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M3.5 1.8c0-.3.3-.6.6-.6h5.2c.2 0 .3.1.4.2l2.9 2.9c.1.1.2.3.2.4v8.7c0 .3-.3.6-.6.6H4.1c-.3 0-.6-.3-.6-.6V1.8z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.05"
      />
      <path d="M9.3 1.2v3.2h3.2" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRight({ size = 12, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className={className}>
      <path
        d="M4.5 2.5L8 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FolderOpenIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M1.5 4.2c0-.4.3-.7.7-.7h3.1c.2 0 .4.1.5.2l1.1 1.1h6.9c.4 0 .7.3.7.7v1"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M1.8 6.5h12.4l-1.8 6.2c-.1.3-.3.5-.6.5H3.2c-.3 0-.6-.2-.6-.5L1.8 6.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.06"
      />
    </svg>
  );
}

export function MarkdownIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="currentColor" fillOpacity="0.05" />
      <path d="M3.5 10.5V6l2 2.2L7.5 6v4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 6v4.5M10 6l1.5 1.5M10 6L8.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PdfIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3.5 1.8c0-.3.3-.6.6-.6h5.2l3.5 3.5v9.1c0 .3-.3.6-.6.6H4.1c-.3 0-.6-.3-.6-.6V1.8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="currentColor" fillOpacity="0.05" />
      <text x="8" y="11" textAnchor="middle" fontSize="3.5" fontWeight="700" fill="currentColor">PDF</text>
    </svg>
  );
}

export function ImageIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="currentColor" fillOpacity="0.05" />
      <circle cx="5.5" cy="6" r="1.2" stroke="currentColor" strokeWidth="1" />
      <path d="M2 11l3.5-3 2.5 2.5L11 7l3 3.5" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

export function TextIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3.5 1.8c0-.3.3-.6.6-.6h5.2l3.5 3.5v9.1c0 .3-.3.6-.6.6H4.1c-.3 0-.6-.3-.6-.6V1.8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="currentColor" fillOpacity="0.05" />
      <path d="M5 7h6M5 9h6M5 11h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function CodeIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3.5 1.8c0-.3.3-.6.6-.6h5.2l3.5 3.5v9.1c0 .3-.3.6-.6.6H4.1c-.3 0-.6-.3-.6-.6V1.8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="currentColor" fillOpacity="0.05" />
      <path d="M6 6.5L4 8l2 1.5M10 6.5L12 8l-2 1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SpacesIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M8 2L14 5L8 8L2 5L8 2Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="currentColor" fillOpacity="0.08" />
      <path d="M2.5 8L8 10.8L13.5 8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11L8 13.8L13.5 11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function EditIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 13l3-1 7.5-7.5-2-2L4 10l-1 3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M10 3.5l2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function SaveIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EyeIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function ExitIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 4.5h10M6.5 4.5V3.2c0-.3.2-.5.5-.5h2c.3 0 .5.2.5.5v1.3M4.5 4.5l.5 8c0 .3.2.5.5.5h5c.3 0 .5-.2.5-.5l.5-8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.8 7v3.5M9.2 7v3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function MoreIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function RenameIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M2.5 13.5l.5-2.5L9.5 4.5l2 2L5 13l-2.5.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M9.5 4.5l1-1 2 2-1 1" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M8 1.5v8M8 9.5L4.5 6M8 9.5L11.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function NewFolderIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M1.5 4.2c0-.4.3-.7.7-.7h3.1c.2 0 .4.1.5.2l1.1 1.1h6.9c.4 0 .7.3.7.7v7.6c0 .4-.3.7-.7.7H2.2c-.4 0-.7-.3-.7-.7V4.2z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function OpenWorkspaceIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M1.5 7c0-.4.3-.7.7-.7h3.1c.2 0 .4.1.5.2l1.1 1.1h6.9c.4 0 .7.3.7.7v4.8c0 .4-.3.7-.7.7H2.2c-.4 0-.7-.3-.7-.7V7z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <path d="M8 5.5V2M8 2L6 4M8 2L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Returns the appropriate icon component for a file based on its name.
 */
export function FileTypeIcon({ name, size = 16 }) {
  const ext = name.split('.').pop().toLowerCase();
  if (['md', 'markdown', 'mdx'].includes(ext)) return <MarkdownIcon size={size} />;
  if (ext === 'pdf') return <PdfIcon size={size} />;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return <ImageIcon size={size} />;
  // Code file extensions → code icon
  const codeExts = ['js','jsx','mjs','cjs','ts','tsx','json','json5','jsonc','css','scss','sass','less','styl','html','htm','xml','xhtml','vue','svelte','yml','yaml','toml','ini','conf','cfg','py','pyw','pyi','java','kt','kts','scala','groovy','c','h','cpp','cc','cxx','hpp','hh','cs','go','rs','rb','erb','php','swift','sh','bash','zsh','fish','ksh','bat','cmd','ps1','sql','graphql','gql','lua','r','dart','pl','pm','clj','cljs','edn','ex','exs','hs','elm','ml','mli','proto','diff','patch','dockerfile','makefile','mk','cmake','nginx','vim','tf','txt','log','csv','env'];
  if (codeExts.includes(ext)) return <CodeIcon size={size} />;
  const base = name.toLowerCase();
  if (base === 'dockerfile' || base === 'makefile') return <CodeIcon size={size} />;
  return <TextIcon size={size} />;
}

/** Layout toggle — sidebar panel icon */
export function LayoutIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="currentColor" fillOpacity="0.05" />
      <rect x="1.5" y="1.5" width="5" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="currentColor" fillOpacity="0.08" />
      <path d="M6.5 3v10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
