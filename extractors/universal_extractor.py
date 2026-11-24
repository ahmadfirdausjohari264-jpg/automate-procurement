"""Text and metadata extraction for non-PDF ITB uploads."""
import csv
import fnmatch
import os
import re
import zipfile
from pathlib import Path
from typing import Dict, List
from xml.etree import ElementTree

from .office_extractor import OfficeExtractor
from .pdf_extractor import IMAGE_EXTENSIONS, PDFExtractor, fitz

TEXT_EXTENSIONS = frozenset({
    ".doc", ".docx", ".txt", ".rtf", ".odt", ".pages",
    ".xls", ".xlsx", ".xlsm", ".csv", ".ods",
    ".ppt", ".pptx", ".key", ".mp3", ".wav", ".m4a",
    ".flac", ".ogg", ".opus", ".aac", ".aiff", ".aif", ".wma",
    ".svg", ".ai",
})
_RASTER_EXTENSIONS = set(IMAGE_EXTENSIONS) - {".svg", ".ai"}
_ODF_TABLE_NS = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
_ODF_TEXT_NS = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _xml_text(node) -> str:
    parts = []

    def visit(element) -> None:
        if element.text:
            parts.append(element.text)
        for child in element:
            name = _local_name(child.tag)
            if name == "s":
                try:
                    count = min(100, max(1, int(child.attrib.get(_ODF_TEXT_NS + "c", "1"))))
                except ValueError:
                    count = 1
                parts.append(" " * count)
            elif name == "tab":
                parts.append("\t")
            elif name == "line-break":
                parts.append("\n")
            else:
                visit(child)
            if child.tail:
                parts.append(child.tail)

    visit(node)
    return "".join(parts).strip()


class UniversalExtractor:
    """Extract readable text and embedded metadata across supported formats."""

    def __init__(self):
        self.office = OfficeExtractor()
        self.pdf = PDFExtractor()

    @staticmethod
    def _read_text(path: str) -> str:
        data = Path(path).read_bytes()
        for encoding in ("utf-8-sig", "utf-16", "cp1252"):
            try:
                return data.decode(encoding).strip()
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", errors="replace").strip()

    @staticmethod
    def _read_csv(path: str) -> str:
        with open(path, "rb") as source:
            prefix = source.read(4)
        encodings = (
            ("utf-16",) if prefix.startswith((b"\xff\xfe", b"\xfe\xff"))
            else ("utf-8-sig", "cp1252")
        )
        for encoding in encodings:
            try:
                with open(path, "r", encoding=encoding, newline="") as handle:
                    rows = csv.reader(handle)
                    return "\n".join(
                        " | ".join(cell.strip() for cell in row)
                        for row in rows
                        if any(cell.strip() for cell in row)
                    )
            except UnicodeDecodeError:
                continue
        with open(path, "r", encoding="utf-8", errors="replace", newline="") as handle:
            rows = csv.reader(handle)
            return "\n".join(
                " | ".join(cell.strip() for cell in row)
                for row in rows
                if any(cell.strip() for cell in row)
            )

    @staticmethod
    def _read_xls(path: str) -> str:
        try:
            import xlrd
        except ImportError as exc:
            raise RuntimeError("xlrd is required to read legacy .xls workbooks.") from exc
        workbook = xlrd.open_workbook(path, on_demand=True)
        try:
            parts = []
            for sheet in workbook.sheets():
                parts.append(f"# Sheet: {sheet.name}")
                for row_index in range(sheet.nrows):
                    cells = [str(value).strip() for value in sheet.row_values(row_index)]
                    if any(cells):
                        parts.append(" | ".join(cells))
            return "\n".join(parts)
        finally:
            workbook.release_resources()

    @staticmethod
    def _read_ods(path: str) -> str:
        try:
            with zipfile.ZipFile(path) as archive:
                root = ElementTree.fromstring(archive.read("content.xml"))
        except (KeyError, OSError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
            raise RuntimeError(f"Could not read the OpenDocument spreadsheet: {exc}") from exc

        parts = []
        for sheet in root.iter(_ODF_TABLE_NS + "table"):
            parts.append(f"# Sheet: {sheet.attrib.get(_ODF_TABLE_NS + 'name', 'Sheet')}")
            for row in sheet.iter(_ODF_TABLE_NS + "table-row"):
                cells = []
                for cell in row:
                    if cell.tag not in {
                        _ODF_TABLE_NS + "table-cell",
                        _ODF_TABLE_NS + "covered-table-cell",
                    }:
                        continue
                    cell_text = " ".join(
                        _xml_text(paragraph)
                        for paragraph in cell.iter()
                        if paragraph.tag in {_ODF_TEXT_NS + "p", _ODF_TEXT_NS + "h"}
                    )
                    try:
                        repeats = min(100, max(1, int(cell.attrib.get(_ODF_TABLE_NS + "number-columns-repeated", "1"))))
                    except ValueError:
                        repeats = 1
                    cells.extend([cell_text] * repeats)
                if any(cells):
                    parts.append(" | ".join(cells))
        return "\n".join(parts)

    @staticmethod
    def _read_odt(path: str) -> str:
        try:
            with zipfile.ZipFile(path) as archive:
                root = ElementTree.fromstring(archive.read("content.xml"))
        except (KeyError, OSError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
            raise RuntimeError(f"Could not read the OpenDocument text file: {exc}") from exc
        return "\n".join(
            text
            for node in root.iter()
            if node.tag in {_ODF_TEXT_NS + "p", _ODF_TEXT_NS + "h"}
            if (text := _xml_text(node))
        )

    @staticmethod
    def _read_pptx(path: str) -> str:
        try:
            from pptx import Presentation
        except ImportError as exc:
            raise RuntimeError("python-pptx is required to read .pptx presentations.") from exc
        presentation = Presentation(path)
        parts = []
        for slide_number, slide in enumerate(presentation.slides, start=1):
            parts.append(f"# Slide: {slide_number}")
            for shape in slide.shapes:
                if shape.has_text_frame and shape.text.strip():
                    parts.append(shape.text.strip())
                if shape.has_table:
                    for row in shape.table.rows:
                        cells = [cell.text.strip() for cell in row.cells]
                        if any(cells):
                            parts.append(" | ".join(cells))
        return "\n".join(parts)

    @staticmethod
    def _read_rtf(path: str) -> str:
        try:
            from striprtf.striprtf import rtf_to_text
        except ImportError as exc:
            raise RuntimeError("striprtf is required to read .rtf documents.") from exc
        return rtf_to_text(UniversalExtractor._read_text(path)).strip()

    @staticmethod
    def _read_audio_metadata(path: str) -> str:
        try:
            from mutagen import File as MutagenFile
        except ImportError as exc:
            raise RuntimeError("mutagen is required to read audio metadata.") from exc
        audio = MutagenFile(path, easy=True)
        if audio is None:
            raise RuntimeError("The audio file metadata could not be read.")
        values = [f"Format: {audio.mime[0]}" if getattr(audio, "mime", None) else "Audio metadata"]
        info = getattr(audio, "info", None)
        if info and getattr(info, "length", None) is not None:
            values.append(f"Duration: {info.length:.1f} seconds")
        if info and getattr(info, "bitrate", None):
            values.append(f"Bitrate: {info.bitrate} bps")
        for key, items in audio.items():
            values.append(f"{key}: {', '.join(str(item) for item in items)}")
        return "\n".join(values)

    def _read_iwork(self, path: str) -> str:
        text_parts = []
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                previews = [
                    name for name in names
                    if name.lower().endswith("preview.pdf") and archive.getinfo(name).file_size <= 30 * 1024 * 1024
                ]
                if previews and fitz is not None:
                    for name in previews[:1]:
                        preview = fitz.open(stream=archive.read(name), filetype="pdf")
                        try:
                            text_parts.extend(
                                page.get_text().strip()
                                for page in preview
                                if page.get_text().strip()
                            )
                        finally:
                            preview.close()
                for name in names:
                    lower = name.lower()
                    if not lower.endswith((".xml", ".apxl")) or archive.getinfo(name).file_size > 5 * 1024 * 1024:
                        continue
                    try:
                        root = ElementTree.fromstring(archive.read(name))
                    except ElementTree.ParseError:
                        continue
                    for node in root.iter():
                        if node.text and node.text.strip():
                            text_parts.append(node.text.strip())
                        for attr, value in node.attrib.items():
                            if _local_name(attr) in {"title", "name", "string", "value"} and value.strip():
                                text_parts.append(value.strip())
        except (OSError, zipfile.BadZipFile):
            pass

        extracted = "\n".join(dict.fromkeys(text_parts))
        if extracted:
            return extracted
        return self.office.extract_with_libreoffice(path, output_format="pdf")

    def _read_svg_text(self, path: str) -> str:
        if os.path.getsize(path) > 10 * 1024 * 1024:
            raise RuntimeError("SVG files larger than 10 MB are not supported.")
        try:
            data = Path(path).read_bytes()
            if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise RuntimeError("SVG files with document type or entity declarations are not supported.")
            root = ElementTree.fromstring(data)
        except (OSError, ElementTree.ParseError) as exc:
            raise RuntimeError(f"Could not read SVG metadata: {exc}") from exc
        values = []
        for node in root.iter():
            if _local_name(node.tag) in {"title", "desc", "text"} and node.text and node.text.strip():
                values.append(node.text.strip())
        return "\n".join(dict.fromkeys(values))

    def _read_ai_text(self, path: str) -> str:
        with open(path, "rb") as handle:
            header = handle.read(16)
        if header.startswith(b"%PDF-"):
            return self.pdf.extract_text_from_pdf(path)
        return ""

    def extract_file(self, path: str) -> str:
        extension = Path(path).suffix.lower()
        if extension in {".doc", ".docx"}:
            return self.office.extract_word_text(path)
        if extension in {".xlsx", ".xlsm"}:
            return self.office.extract_xlsx_text(path)
        if extension == ".xls":
            return self._read_xls(path)
        if extension == ".csv":
            return self._read_csv(path)
        if extension == ".txt":
            return self._read_text(path)
        if extension == ".rtf":
            return self._read_rtf(path)
        if extension == ".odt":
            return self._read_odt(path)
        if extension == ".ods":
            return self._read_ods(path)
        if extension == ".pptx":
            return self._read_pptx(path)
        if extension in {".ppt", ".pages", ".key"}:
            if extension in {".pages", ".key"}:
                return self._read_iwork(path)
            return self.office.extract_with_libreoffice(path, output_format="pdf")
        if extension in {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".aiff", ".aif", ".wma"}:
            return self._read_audio_metadata(path)
        if extension == ".svg":
            return self._read_svg_text(path)
        if extension == ".ai":
            return self._read_ai_text(path)
        raise ValueError(f"Unsupported file type: {extension}")

    def extract_folder(self, folder: str, pattern: str = "*") -> List[Dict]:
        """Extract text or metadata from all supported non-PDF files in a folder."""
        results = []
        for filename in os.listdir(folder):
            extension = Path(filename).suffix.lower()
            if extension not in TEXT_EXTENSIONS or extension in _RASTER_EXTENSIONS:
                continue
            if not fnmatch.fnmatch(filename, pattern):
                continue
            path = os.path.join(folder, filename)
            try:
                content = self.extract_file(path)
                results.append({
                    "filename": filename,
                    "path": path,
                    "content": content,
                    "size": len(content),
                })
            except Exception as exc:
                results.append({
                    "filename": filename,
                    "path": path,
                    "error": str(exc),
                    "content": "",
                })
        return results
