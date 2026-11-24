"""Word (.docx/.doc) and Excel (.xlsx/.xlsm) text extraction for ITB packages."""
import fnmatch
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List

# Office document extensions this extractor can read.
WORD_EXTENSIONS = ('.docx', '.doc')
EXCEL_EXTENSIONS = ('.xlsx', '.xlsm')


class OfficeExtractor:
    """Reads text out of Word and Excel documents found in a folder."""

    def extract_docx_text(self, path: str) -> str:
        """Return body, table, header and footer text from a .docx."""
        try:
            from docx import Document
        except ImportError as e:
            raise RuntimeError(
                "python-docx is required to read .docx files (pip install python-docx)."
            ) from e
        doc = Document(path)
        parts: List[str] = []

        def append_part(part) -> None:
            for para in part.paragraphs:
                text = para.text.strip()
                if text:
                    parts.append(text)
            for table in part.tables:
                for row in table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))

        append_part(doc)
        for section in doc.sections:
            append_part(section.header)
            append_part(section.footer)
        return "\n".join(parts)

    def extract_doc_text(self, path: str) -> str:
        """Extract legacy binary .doc text with Antiword or LibreOffice."""
        antiword = shutil.which("antiword")
        antiword_error = None
        if antiword:
            try:
                result = subprocess.run(
                    [antiword, path],
                    check=True,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=60,
                )
                if result.stdout.strip():
                    return result.stdout.strip()
                antiword_error = "The document contains no readable text."
            except (OSError, subprocess.SubprocessError) as exc:
                antiword_error = f"Antiword could not read the file: {exc}"

        try:
            return self.extract_with_libreoffice(path)
        except RuntimeError as exc:
            if antiword_error:
                raise RuntimeError(f"{antiword_error} LibreOffice fallback: {exc}") from exc
            raise

    def extract_with_libreoffice(self, path: str, output_format: str = "txt:Text") -> str:
        """Convert an Office/iWork file to text or PDF with a headless LibreOffice."""
        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        if not soffice:
            raise RuntimeError(
                "This file format requires LibreOffice (soffice) on the server."
            )

        extension = output_format.split(":", 1)[0].lower()
        with tempfile.TemporaryDirectory(prefix="itb-convert-") as temp_dir:
            output_dir = Path(temp_dir)
            command = [
                soffice,
                "--headless",
                "--nologo",
                "--nodefault",
                "--nolockcheck",
                "--norestore",
                f"-env:UserInstallation={(output_dir / 'profile').as_uri()}",
                "--convert-to",
                output_format,
                "--outdir",
                str(output_dir),
                path,
            ]
            try:
                subprocess.run(
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=60,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                detail = getattr(exc, "stderr", None)
                detail = detail.strip() if isinstance(detail, str) and detail.strip() else str(exc)
                raise RuntimeError(f"LibreOffice could not read the file: {detail}") from exc

            converted_path = output_dir / f"{Path(path).stem}.{extension}"
            if not converted_path.is_file():
                raise RuntimeError("LibreOffice did not produce a readable conversion.")
            if extension == "pdf":
                from .pdf_extractor import PDFExtractor

                return PDFExtractor().extract_text_from_pdf(str(converted_path))
            text = converted_path.read_text(encoding="utf-8", errors="replace").strip()
            if not text:
                raise RuntimeError("The converted document contains no readable text.")
            return text

    def extract_word_text(self, path: str) -> str:
        """Read a modern .docx file or convert a legacy .doc file."""
        if Path(path).suffix.lower() == ".doc":
            return self.extract_doc_text(path)
        return self.extract_docx_text(path)

    def extract_xlsx_text(self, path: str) -> str:
        """Return every non-empty spreadsheet row as ``a | b | c`` text lines.

        Each sheet is prefixed with a ``# Sheet: <name>`` marker so the model
        can tell workbook tabs apart.
        """
        try:
            from openpyxl import load_workbook
        except ImportError as e:
            raise RuntimeError(
                "openpyxl is required to read .xlsx files (pip install openpyxl)."
            ) from e
        wb = load_workbook(path, read_only=True, data_only=True)
        parts: List[str] = []
        try:
            for ws in wb.worksheets:
                parts.append(f"# Sheet: {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    cells = ["" if v is None else str(v).strip() for v in row]
                    if any(cells):
                        parts.append(" | ".join(cells))
        finally:
            wb.close()
        return "\n".join(parts)

    def extract_office_folder(self, folder: str, pattern: str = '*') -> List[Dict]:
        """Read every supported Word/Excel file in a folder matching a glob.

        Returns the same shape as ``PDFExtractor.extract_itb_folder``: one dict
        per file with ``filename``, ``path``, ``content`` and ``size``, or an
        ``error`` key with empty content when a file cannot be read.
        """
        results: List[Dict] = []
        for fname in os.listdir(folder):
            low = fname.lower()
            if low.endswith(WORD_EXTENSIONS):
                reader = self.extract_word_text
            elif low.endswith(EXCEL_EXTENSIONS):
                reader = self.extract_xlsx_text
            else:
                continue
            if not fnmatch.fnmatch(fname, pattern):
                continue
            path = os.path.join(folder, fname)
            try:
                content = reader(path)
                results.append({
                    'filename': fname,
                    'path': path,
                    'content': content,
                    'size': len(content),
                })
            except Exception as e:
                results.append({
                    'filename': fname,
                    'path': path,
                    'error': str(e),
                    'content': '',
                })
        return results
