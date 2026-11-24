"""Safe document staging and AI-backed supplier row extraction."""
import csv
import re
import tempfile
import zipfile
from pathlib import Path
from typing import List, Optional
from xml.etree import ElementTree

from pydantic import BaseModel, Field

from extractors.office_extractor import OfficeExtractor
from extractors.pdf_extractor import PDFExtractor

from .ai_providers import ImagePart, ProviderClient, extract_json
from .upload_guard import UploadValidationError, save_uploads

MAX_TEXT_CHARS = 100_000
MAX_IMAGE_PARTS = 12
SUPPLIER_UPLOAD_EXTENSIONS = frozenset({
    ".pdf", ".doc", ".docx", ".xlsx", ".xlsm", ".csv", ".pptx",
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff",
})


class ExtractedSupplier(BaseModel):
    company_name: str = Field("", description="Supplier or contractor legal/business name")
    business_scope: str = Field("", description="Business activity, services, or product scope")
    website: str = Field("", description="Website URL, if present")
    email: str = Field("", description="Contact email, if present")
    contact: str = Field("", description="Contact person or phone, if present")


class SupplierExtraction(BaseModel):
    suppliers: List[ExtractedSupplier] = Field(default_factory=list)


def _read_csv(path: Path) -> str:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = csv.reader(handle)
        return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows if any(cell.strip() for cell in row))


def _read_pptx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        slide_names = [
            name for name in archive.namelist()
            if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
        ]
        slide_names.sort(key=lambda name: int(re.search(r"slide(\d+)", name).group(1)))
        parts = []
        for slide_name in slide_names:
            root = ElementTree.fromstring(archive.read(slide_name))
            texts = [
                node.text.strip()
                for node in root.iter()
                if node.tag.rsplit("}", 1)[-1] == "t" and node.text and node.text.strip()
            ]
            if texts:
                parts.append(" | ".join(texts))
        return "\n".join(parts)


def _render_pdf_pages(path: Path, temp_path: Path, page_limit: int) -> List[Path]:
    try:
        import pymupdf as fitz
    except ImportError:
        try:
            import fitz
        except ImportError as exc:
            raise RuntimeError("PyMuPDF is required to read scanned PDFs.") from exc

    rendered = []
    with fitz.open(path) as document:
        for index, page in enumerate(document):
            if len(rendered) >= page_limit:
                raise ValueError(f"An upload may contain at most {MAX_IMAGE_PARTS} image pages or image files.")
            image_path = temp_path / f"{path.stem}-page-{index + 1}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3), alpha=False).save(str(image_path))
            rendered.append(image_path)
    return rendered


def _extract_parts(paths: List[Path], temp_path: Path):
    office = OfficeExtractor()
    pdf = PDFExtractor()
    parts = []
    images = []
    text_size = 0

    for path in paths:
        extension = path.suffix.lower()
        if extension in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}:
            images.append(path)
            if len(images) > MAX_IMAGE_PARTS:
                raise ValueError(f"Upload at most {MAX_IMAGE_PARTS} image pages/files at a time.")
            continue
        if extension in {".docx", ".doc"}:
            content = office.extract_word_text(str(path))
        elif extension in {".xlsx", ".xlsm"}:
            content = office.extract_xlsx_text(str(path))
        elif extension == ".pdf":
            content = pdf.extract_text_from_pdf(str(path))
            if not content.strip():
                images.extend(_render_pdf_pages(path, temp_path, MAX_IMAGE_PARTS - len(images)))
                continue
        elif extension == ".csv":
            content = _read_csv(path)
        elif extension == ".pptx":
            content = _read_pptx(path)
        else:
            raise ValueError(f"Unsupported file type: {path.suffix}")

        text_size += len(content)
        if text_size > MAX_TEXT_CHARS:
            raise ValueError(
                f"Extracted text exceeds {MAX_TEXT_CHARS:,} characters. Split the files into smaller uploads."
            )
        if content.strip():
            parts.append(f"FILE: {path.name}\n{content}")

    if len(images) > MAX_IMAGE_PARTS:
        raise ValueError(f"Upload at most {MAX_IMAGE_PARTS} image pages/files at a time.")
    parts.extend(ImagePart(str(path)) for path in images)
    if not parts:
        raise ValueError("No readable text or images were found in the uploaded files.")
    return parts


def parse_supplier_files(
    uploads,
    provider: str,
    api_key: Optional[str],
    model: Optional[str],
) -> List[dict]:
    """Validate documents, extract their text/images, and return reviewed-row drafts."""
    with tempfile.TemporaryDirectory(prefix="supplier-parse-") as temp_dir:
        temp_path = Path(temp_dir)
        filenames = save_uploads(
            uploads,
            temp_path,
            allowed_extensions=SUPPLIER_UPLOAD_EXTENSIONS,
        )
        paths = [temp_path / filename for filename in filenames]
        parts = _extract_parts(paths, temp_path)
        client = ProviderClient(provider=provider, api_key=api_key, model=model)
        raw = client.generate_json(
            parts,
            SupplierExtraction,
            system=(
                "Extract supplier, contractor, or vendor records from the supplied documents. "
                "Do not return buyers, customers, project owners, or procuring organizations. "
                "Never invent missing details. Return an empty string for unknown fields. "
                "For each supplier, extract its name, business scope, website, contact email, "
                "and contact person or phone when present."
            ),
            temperature=0.0,
            max_tokens=12000,
        )
        result = extract_json(raw, SupplierExtraction)
        source = ", ".join(filename for filename in filenames)
        return [
            {
                "company_name": supplier.company_name.strip(),
                "business_scope": supplier.business_scope.strip(),
                "website": supplier.website.strip(),
                "email": supplier.email.strip(),
                "contact": supplier.contact.strip(),
                "source": source,
                "notes": "",
                "tags": "",
            }
            for supplier in result.suppliers
            if supplier.company_name.strip() or supplier.website.strip()
        ]
