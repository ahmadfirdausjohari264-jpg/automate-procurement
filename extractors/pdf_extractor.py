"""PDF text and image extraction utilities for ITB packages."""
import os
import fnmatch
from typing import Dict, List

# PyMuPDF is the primary engine (fast); pdfplumber is a pure-Python fallback.
try:
    import pymupdf as fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        fitz = None

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

# Extensions treated as standalone images (screenshots) inside an ITB folder.
IMAGE_EXTENSIONS = (
    '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff',
    '.svg', '.psd', '.ai',
)


class PDFExtractor:
    """Reads text out of PDFs and finds images/screenshots in a folder."""

    def __init__(self, engine: str = "pymupdf"):
        """Store the preferred engine name (PyMuPDF, with pdfplumber fallback)."""
        self.engine = engine

    def extract_text_from_pdf(self, pdf_path: str) -> str:
        """Return the concatenated text of every page in a single PDF.

        Uses PyMuPDF when available because it is far faster than pdfplumber;
        falls back to pdfplumber only if PyMuPDF is missing.
        """
        if fitz is not None:
            doc = fitz.open(pdf_path)
            try:
                pages = []
                for page in doc:
                    text = page.get_text()
                    if text and text.strip():
                        pages.append(text.strip())
                return "\n\n".join(pages)
            finally:
                doc.close()

        if pdfplumber is None:
            raise RuntimeError(
                "No PDF engine available. Install pymupdf (preferred) or pdfplumber."
            )
        text = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    text.append(extracted)
        return "\n".join(text)

    def render_scanned_pages(
        self, pdf_path: str, output_dir: str, max_pages: int = 12
    ) -> List[str]:
        """Render pages with little extractable text for the vision OCR path."""
        if max_pages <= 0:
            return []
        if fitz is None:
            raise RuntimeError("PyMuPDF is required to render scanned PDF pages.")

        rendered: List[str] = []
        output_path = os.path.abspath(output_dir)
        stem = os.path.splitext(os.path.basename(pdf_path))[0]
        with fitz.open(pdf_path) as doc:
            for index, page in enumerate(doc):
                if len(rendered) >= max_pages:
                    break
                if len((page.get_text() or "").strip()) >= 40:
                    continue
                page_size = max(page.rect.width, page.rect.height)
                if page_size <= 0:
                    continue
                scale = min(2.0, 2200 / page_size)
                image_path = os.path.join(output_path, f"{stem}-page-{index + 1}.png")
                page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(image_path)
                rendered.append(image_path)
        return rendered

    def extract_itb_folder(self, itb_dir: str, pattern: str = '*.pdf') -> List[Dict]:
        """Read every PDF in a folder that matches a filename glob.

        Returns one dict per file with keys ``filename``, ``path``, ``content``
        and ``size``; unreadable files carry an ``error`` key and empty content.
        """
        results = []
        for fname in os.listdir(itb_dir):
            if fname.lower().endswith('.pdf') and fnmatch.fnmatch(fname, pattern):
                path = os.path.join(itb_dir, fname)
                try:
                    content = self.extract_text_from_pdf(path)
                    results.append({
                        'filename': fname,
                        'path': path,
                        'content': content,
                        'size': len(content)
                    })
                except Exception as e:
                    results.append({
                        'filename': fname,
                        'path': path,
                        'error': str(e),
                        'content': ''
                    })
        return results

    def collect_image_files(self, folder: str, patterns: List[str] = None) -> List[str]:
        """Collect standalone image files (e.g. screenshots) from a folder."""
        patterns = patterns or [
            '*.png', '*.jpg', '*.jpeg', '*.webp', '*.bmp', '*.gif', '*.tif', '*.tiff',
            '*.svg', '*.psd', '*.ai',
        ]
        found = []
        for fname in os.listdir(folder):
            if fname.lower().endswith(IMAGE_EXTENSIONS) and any(
                fnmatch.fnmatch(fname, p) for p in patterns
            ):
                found.append(os.path.join(folder, fname))
        return sorted(found)
