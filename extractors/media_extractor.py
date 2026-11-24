"""Normalize uploaded graphics to provider-compatible PNG images."""
from io import BytesIO
from pathlib import Path
from typing import List, Sequence
from xml.etree import ElementTree


_MAX_IMAGE_DIMENSION = 2200


def _load_safe_svg(path: str):
    data = Path(path).read_bytes()
    if len(data) > 10 * 1024 * 1024:
        raise RuntimeError("SVG files larger than 10 MB are not supported.")
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise RuntimeError("SVG files with document type or entity declarations are not supported.")
    root = ElementTree.fromstring(data)
    for parent in root.iter():
        for child in list(parent):
            if child.tag.rsplit("}", 1)[-1].lower() == "script":
                parent.remove(child)
        if parent.tag.rsplit("}", 1)[-1].lower() == "style" and parent.text:
            if "url(" in parent.text.lower() or "@import" in parent.text.lower():
                parent.text = ""
        for name, value in list(parent.attrib.items()):
            local_name = name.rsplit("}", 1)[-1].lower()
            if local_name in {"href", "src"} and not value.strip().startswith("#"):
                del parent.attrib[name]
            elif "url(" in value.lower() or "@import" in value.lower():
                del parent.attrib[name]
    return root


def _render_ai(path: str, output_dir: str) -> List[str]:
    try:
        import pymupdf as fitz
    except ImportError:
        try:
            import fitz
        except ImportError as exc:
            raise RuntimeError("PyMuPDF is required to read PDF-compatible Illustrator files.") from exc

    try:
        with fitz.open(path) as document:
            rendered = []
            for index, page in enumerate(document):
                if index >= 12:
                    break
                page_size = max(page.rect.width, page.rect.height)
                if page_size <= 0:
                    continue
                scale = min(2.0, _MAX_IMAGE_DIMENSION / page_size)
                output = Path(output_dir) / f"{Path(path).stem}-artboard-{index + 1}.png"
                page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(str(output))
                rendered.append(str(output))
            if rendered:
                return rendered
    except Exception as exc:
        raise RuntimeError(
            "The .ai file must be saved with PDF compatibility to be rendered."
        ) from exc
    raise RuntimeError("The Illustrator file contains no renderable artboards.")


def prepare_vision_images(paths: Sequence[str], output_dir: str) -> List[str]:
    """Convert raster, PSD, SVG and PDF-compatible AI files to PNG for AI vision."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow is required to normalize uploaded images.") from exc

    normalized = []
    for index, path in enumerate(paths):
        extension = Path(path).suffix.lower()
        if extension == ".ai":
            normalized.extend(_render_ai(path, output_dir))
            continue

        output = Path(output_dir) / f"{index:04d}-{Path(path).stem}.png"
        try:
            if extension == ".svg":
                from reportlab.graphics import renderPDF
                from reportlab.pdfgen.canvas import Canvas
                from svglib.svglib import svg2rlg

                svg_root = _load_safe_svg(path)
                drawing = svg2rlg(BytesIO(ElementTree.tostring(svg_root, encoding="utf-8")))
                if drawing is None:
                    raise RuntimeError("The SVG contains no renderable content.")
                width = max(1.0, float(drawing.width))
                height = max(1.0, float(drawing.height))
                pdf_buffer = BytesIO()
                canvas = Canvas(pdf_buffer, pagesize=(width, height))
                renderPDF.draw(drawing, canvas, 0, 0)
                canvas.save()
                try:
                    import pymupdf as fitz
                except ImportError:
                    import fitz
                with fitz.open(stream=pdf_buffer.getvalue(), filetype="pdf") as document:
                    page = document[0]
                    scale = min(2.0, _MAX_IMAGE_DIMENSION / max(page.rect.width, page.rect.height))
                    page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(str(output))
            else:
                with Image.open(path) as image:
                    image.seek(0)
                    image.load()
                    image.thumbnail((_MAX_IMAGE_DIMENSION, _MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
                    if image.mode not in {"RGB", "RGBA"}:
                        image = image.convert("RGBA" if "transparency" in image.info else "RGB")
                    image.save(output, format="PNG")
        except Exception as exc:
            raise RuntimeError(f"Could not prepare image {Path(path).name}: {exc}") from exc
        normalized.append(str(output))
    return normalized
