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

/**
 * Returns the appropriate icon component for a file based on its name.
 */
export function FileTypeIcon({ name, size = 16 }) {
  const ext = name.split('.').pop().toLowerCase();
  if (['md', 'markdown', 'mdx'].includes(ext)) return <MarkdownIcon size={size} />;
  if (ext === 'pdf') return <PdfIcon size={size} />;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return <ImageIcon size={size} />;
  return <TextIcon size={size} />;
}
