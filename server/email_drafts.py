"""Build editable supplier email drafts from completed specification data."""
from datetime import datetime
import uuid
from typing import Dict, List


def _text(value) -> str:
    return " ".join(str(value or "").split()).strip()


def _items(data: Dict) -> List[Dict]:
    return [item for item in data.get("line_items") or [] if isinstance(item, dict)]


def _supplier(data: Dict) -> Dict:
    for group in data.get("suppliers") or []:
        if not isinstance(group, dict):
            continue
        for supplier in group.get("suppliers") or []:
            if isinstance(supplier, dict) and (
                _text(supplier.get("email")) or _text(supplier.get("company_name"))
            ):
                return supplier
    return {}


def _requirements(data: Dict) -> List[str]:
    values = []
    for key in (
        "technical_requirements",
        "commercial_requirements",
        "submission_rules",
        "mandatory_requirements",
    ):
        for value in data.get(key) or []:
            text = _text(value)
            if text and text not in values:
                values.append(text)
    return values


def _format_item(item: Dict, index: int) -> List[str]:
    name = _text(item.get("item_name") or item.get("description"))
    if not name:
        return []
    code = _text(item.get("item_number") or item.get("item_no"))
    quantity = " ".join(
        part for part in (_text(item.get("qty")), _text(item.get("uom"))) if part
    )
    line = f"{index}. {name}"
    if code:
        line += f" (reference: {code})"
    if quantity:
        line += f" — quantity: {quantity}"
    lines = [line]
    for spec in item.get("specs") or []:
        if not isinstance(spec, dict):
            continue
        parameter = _text(spec.get("parameter"))
        value = _text(spec.get("value"))
        detail = ": ".join(part for part in (parameter, value) if part)
        if detail:
            lines.append(f"   - {detail}")
    return lines


def build_email_draft(job, mode: str = "pipeline") -> Dict:
    """Create a fresh blank or pipeline-suggested draft and attachment options."""
    data = job.data or {}
    meta = data.get("meta") or {}
    items = _items(data)
    supplier = _supplier(data)
    version = job.versions[-1] if job.versions else {}
    version_id = version.get("id")
    version_tag = _text(version.get("tag")) or None
    reference = _text(meta.get("project_ref"))
    title = _text(meta.get("project_title"))
    client = _text(meta.get("buyer"))
    supplier_name = _text(supplier.get("company_name"))
    supplier_email = _text(supplier.get("email"))
    deadline = _text(meta.get("submission_deadline") or meta.get("deadline"))
    dates = [_text(value) for value in data.get("dates") or [] if _text(value)]
    requirements = _requirements(data)

    if reference:
        subject = f"RFQ {reference} - Request for Quotation"
    elif title:
        subject = f"Quotation Request - {title}"
    elif items:
        item_name = _text(items[0].get("item_name") or items[0].get("description"))
        subject = f"Quotation Request - {item_name}" if item_name else "Request for Quotation"
    else:
        subject = "Request for Quotation"

    if mode == "pipeline":
        greeting = f"Dear {supplier_name} Sales Team," if supplier_name else "Dear Sir/Madam,"
        lines = [
            greeting,
            "",
            "We would like to request a quotation based on the tender information below.",
        ]
        if reference:
            lines.append(f"Tender / RFQ reference: {reference}")
        if title:
            lines.append(f"Tender title: {title}")
        if client:
            lines.append(f"Client: {client}")
        if items:
            lines.extend(["", "Requested items:"])
            for index, item in enumerate(items, start=1):
                lines.extend(_format_item(item, index))
        if dates:
            lines.extend(["", f"Relevant tender dates: {', '.join(dates)}"])
        if deadline:
            lines.extend(["", f"Submission deadline: {deadline}"])
        if version_tag:
            lines.extend(["", f"Please use specification version {version_tag} as the basis for your quotation."])
        if requirements:
            lines.extend(["", "Please address the following requirements:"])
            lines.extend(f"- {requirement}" for requirement in requirements[:8])
        lines.extend([
            "",
            "Please include your pricing, delivery lead time, quotation validity, technical compliance, and any assumptions or exclusions.",
            "Please let us know if you need any clarification.",
            "",
            "Best regards,",
        ])
        to = supplier_email
        cc = ""
        bcc = ""
    else:
        subject = ""
        lines = []
        to = ""
        cc = ""
        bcc = ""

    attachment_options = []
    if version_tag and job.output_path:
        attachment_options.append({
            "id": "specification_sheet",
            "name": f"Specification Sheet {version_tag}",
            "kind": "specification",
        })
    for filename in data.get("source_files") or job.files:
        name = _text(filename)
        if name:
            attachment_options.append({
                "id": f"source:{name}",
                "name": name,
                "kind": "source",
            })

    summary = {"item_count": len(items), "specification_status": "Complete"}
    for key, value in (
        ("reference", reference),
        ("client", client),
        ("title", title),
        ("supplier", supplier_name),
        ("supplier_email", supplier_email),
        ("specification_version", version_tag),
        ("submission_deadline", deadline),
    ):
        if value:
            summary[key] = value
    if dates:
        summary["tender_dates"] = dates
    if requirements:
        summary["notes"] = requirements[:8]

    now = datetime.now().isoformat(timespec="seconds")
    summary["generated_at"] = now
    return {
        "id": uuid.uuid4().hex[:12],
        "source_version_id": version_id,
        "source_version_tag": version_tag,
        "created_at": now,
        "updated_at": now,
        "mode": mode,
        "to": to,
        "cc": cc,
        "bcc": bcc,
        "subject": subject,
        "body": "\n".join(lines),
        "available_attachments": attachment_options,
        "selected_attachments": [],
        "summary": summary,
        "edited": False,
    }
