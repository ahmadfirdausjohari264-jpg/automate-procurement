const SUPPORTED_EXTENSIONS = new Set([
  ".doc", ".docx", ".pdf", ".txt", ".rtf", ".odt", ".pages",
  ".xls", ".xlsx", ".xlsm", ".csv", ".ods",
  ".ppt", ".pptx", ".key",
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff",
  ".svg", ".psd", ".ai",
  ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".aiff", ".aif", ".wma",
]);

export const ITB_FILE_ACCEPT = "*/*";

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index < 0 ? "" : filename.slice(index).toLowerCase();
}

export function isSupportedItbFile(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extensionOf(filename));
}

export function getFileTypeBadge(filename: string): { label: string; className: string } {
  const extension = extensionOf(filename);
  if ([".doc", ".docx", ".pdf", ".txt", ".rtf", ".odt", ".pages"].includes(extension)) {
    return { label: extension, className: "border-red/35 bg-red/10 text-red" };
  }
  if ([".xls", ".xlsx", ".xlsm", ".csv", ".ods"].includes(extension)) {
    return { label: extension, className: "border-teal/30 bg-teal/10 text-teal" };
  }
  if ([".ppt", ".pptx", ".key"].includes(extension)) {
    return { label: extension, className: "border-amber-400/30 bg-amber-400/10 text-amber-300" };
  }
  return { label: extension, className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300" };
}
