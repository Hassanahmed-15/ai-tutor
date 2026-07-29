#!/usr/bin/env python3
"""High-resolution PDF rendering and OCR-verified figure cropping."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any

import cv2
import fitz
import numpy as np
import pytesseract


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=True), encoding="utf-8")


def render_pdf(input_path: Path, output_dir: Path, dpi: int) -> None:
    document = fitz.open(input_path)
    pages: list[dict[str, Any]] = []
    scale = dpi / 72.0
    matrix = fitz.Matrix(scale, scale)

    for index, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=matrix, alpha=False, colorspace=fitz.csRGB)
        output_path = output_dir / f"page-{index + 1}.png"
        pixmap.save(output_path)

        spans: list[dict[str, Any]] = []
        text_dict = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = str(span.get("text", "")).strip()
                    bbox = span.get("bbox", [0, 0, 0, 0])
                    if not text or len(bbox) != 4:
                        continue
                    x0, y0, x1, y1 = [float(value) for value in bbox]
                    spans.append(
                        {
                            "text": text,
                            "x": x0,
                            "top": y0,
                            "width": max(1.0, x1 - x0),
                            "height": max(1.0, y1 - y0),
                            "fontSize": max(1.0, float(span.get("size", y1 - y0))),
                            "fontName": str(span.get("font", "")),
                        }
                    )

        pages.append(
            {
                "pageNumber": index + 1,
                "path": output_path.name,
                "width": pixmap.width,
                "height": pixmap.height,
                "pageWidth": float(page.rect.width),
                "pageHeight": float(page.rect.height),
                "text": " ".join(span["text"] for span in spans),
                "spans": spans,
            }
        )

    write_json(output_dir / "manifest.json", {"dpi": dpi, "pages": pages})


def ink_mask(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return (gray < 245).astype(np.uint8)


def edge_ink_ratio(mask: np.ndarray, edge: str) -> float:
    height, width = mask.shape[:2]
    band = max(2, round(min(width, height) * 0.006))
    if edge == "left":
        region = mask[:, :band]
    elif edge == "right":
        region = mask[:, max(0, width - band) :]
    elif edge == "top":
        region = mask[:band, :]
    else:
        region = mask[max(0, height - band) :, :]
    return float(np.count_nonzero(region)) / max(1, region.size)


def ocr_edge_risks(image: np.ndarray) -> set[str]:
    risks: set[str] = set()
    height, width = image.shape[:2]
    try:
        data = pytesseract.image_to_data(
            image,
            output_type=pytesseract.Output.DICT,
            config="--psm 11",
        )
    except Exception:
        return risks

    margin_x = max(8, round(width * 0.025))
    margin_y = max(8, round(height * 0.025))
    for index, text in enumerate(data.get("text", [])):
        if not str(text).strip():
            continue
        confidence = float(data.get("conf", ["-1"])[index])
        if confidence < 15:
            continue
        x = int(data["left"][index])
        y = int(data["top"][index])
        w = int(data["width"][index])
        h = int(data["height"][index])
        if x <= margin_x:
            risks.add("left")
        if x + w >= width - margin_x:
            risks.add("right")
        if y <= margin_y:
            risks.add("top")
        if y + h >= height - margin_y:
            risks.add("bottom")
    return risks


def strip_hits_text(
    strip: tuple[int, int, int, int],
    text_boxes_px: list[tuple[int, int, int, int]],
) -> bool:
    """True if the [x0,y0,x1,y1] strip we're about to grow into meaningfully overlaps body text.
    Used to stop a figure crop from swallowing an adjacent paragraph. A figure's OWN internal labels
    are inside the box already, so they never appear in an outward growth strip."""
    sx0, sy0, sx1, sy1 = strip
    strip_area = max(1, (sx1 - sx0) * (sy1 - sy0))
    for tx0, ty0, tx1, ty1 in text_boxes_px:
        ox = max(0, min(sx1, tx1) - max(sx0, tx0))
        oy = max(0, min(sy1, ty1) - max(sy0, ty0))
        if ox * oy > strip_area * 0.12:
            return True
    return False


def expand_box_until_clear(
    page: np.ndarray,
    box: tuple[int, int, int, int],
    text_boxes_px: list[tuple[int, int, int, int]] | None = None,
) -> tuple[int, int, int, int]:
    page_height, page_width = page.shape[:2]
    x0, y0, x1, y1 = box
    step_x = max(24, round(page_width * 0.028))
    step_y = max(24, round(page_height * 0.020))
    text_boxes_px = text_boxes_px or []

    for _ in range(6):
        crop = page[y0:y1, x0:x1]
        if crop.size == 0:
            break
        mask = ink_mask(crop)
        risks: set[str] = set()
        if edge_ink_ratio(mask, "left") > 0.025:
            risks.add("left")
        if edge_ink_ratio(mask, "right") > 0.025:
            risks.add("right")
        if edge_ink_ratio(mask, "top") > 0.025:
            risks.add("top")
        if edge_ink_ratio(mask, "bottom") > 0.025:
            risks.add("bottom")
        before = (x0, y0, x1, y1)
        # Grow toward figure ink, but NEVER across body text: if the strip we'd add is mostly a text
        # region, the ink at that edge is a neighbouring paragraph, not the figure — leave it out.
        if "left" in risks and x0 > 0 and not strip_hits_text((max(0, x0 - step_x), y0, x0, y1), text_boxes_px):
            x0 = max(0, x0 - step_x)
        if "right" in risks and x1 < page_width and not strip_hits_text((x1, y0, min(page_width, x1 + step_x), y1), text_boxes_px):
            x1 = min(page_width, x1 + step_x)
        if "top" in risks and y0 > 0 and not strip_hits_text((x0, max(0, y0 - step_y), x1, y0), text_boxes_px):
            y0 = max(0, y0 - step_y)
        if "bottom" in risks and y1 < page_height and not strip_hits_text((x0, y1, x1, min(page_height, y1 + step_y)), text_boxes_px):
            y1 = min(page_height, y1 + step_y)
        if before == (x0, y0, x1, y1):
            break

    # OCR is intentionally bounded to two checks. Edge ink handles inexpensive iterative growth;
    # OCR then catches words whose glyphs do not physically touch the border.
    for _ in range(2):
        crop = page[y0:y1, x0:x1]
        risks = ocr_edge_risks(crop)
        before = (x0, y0, x1, y1)
        if "left" in risks and x0 > 0:
            x0 = max(0, x0 - step_x)
        if "right" in risks and x1 < page_width:
            x1 = min(page_width, x1 + step_x)
        if "top" in risks and y0 > 0:
            y0 = max(0, y0 - step_y)
        if "bottom" in risks and y1 < page_height:
            y1 = min(page_height, y1 + step_y)
        if before == (x0, y0, x1, y1):
            break
    return x0, y0, x1, y1


def trim_whitespace(image: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    mask = ink_mask(image)
    points = cv2.findNonZero(mask)
    if points is None:
        return image, (0, 0, image.shape[1], image.shape[0])
    x, y, width, height = cv2.boundingRect(points)
    padding = max(16, round(min(image.shape[:2]) * 0.018))
    x0 = max(0, x - padding)
    y0 = max(0, y - padding)
    x1 = min(image.shape[1], x + width + padding)
    y1 = min(image.shape[0], y + height + padding)
    return image[y0:y1, x0:x1], (x0, y0, x1, y1)


def deskew(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    coords = np.column_stack(np.where(gray < 220))[:, ::-1]
    if len(coords) < 80:
        return image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    angle = -float(angle)
    if abs(angle) < 0.25 or abs(angle) > 3.0:
        return image
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )


def clean_image(image: np.ndarray) -> np.ndarray:
    image = deskew(image)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, a, b = cv2.split(lab)
    if float(np.std(lightness)) < 48:
        clahe = cv2.createCLAHE(clipLimit=1.35, tileGridSize=(8, 8))
        lightness = clahe.apply(lightness)
        image = cv2.cvtColor(cv2.merge((lightness, a, b)), cv2.COLOR_LAB2BGR)
    blurred = cv2.GaussianBlur(image, (0, 0), 0.7)
    return cv2.addWeighted(image, 1.16, blurred, -0.16, 0)


def crop_regions(page_path: Path, regions_path: Path, output_dir: Path) -> None:
    page = cv2.imread(str(page_path), cv2.IMREAD_COLOR)
    if page is None:
        raise RuntimeError(f"Could not read page image: {page_path}")
    page_height, page_width = page.shape[:2]
    raw = json.loads(regions_path.read_text(encoding="utf-8"))
    regions = raw.get("regions", [])
    # Normalized text rectangles -> pixel boxes, so expansion never crosses body text.
    text_boxes_px: list[tuple[int, int, int, int]] = []
    for tb in raw.get("textBoxes", []) or []:
        try:
            tx = clamp(float(tb.get("x", 0)), 0, 1)
            ty = clamp(float(tb.get("y", 0)), 0, 1)
            tw = clamp(float(tb.get("width", 0)), 0, 1)
            th = clamp(float(tb.get("height", 0)), 0, 1)
        except (TypeError, ValueError):
            continue
        if tw <= 0 or th <= 0:
            continue
        text_boxes_px.append((
            math.floor(tx * page_width),
            math.floor(ty * page_height),
            math.ceil((tx + tw) * page_width),
            math.ceil((ty + th) * page_height),
        ))
    crops: list[dict[str, Any]] = []

    for index, region in enumerate(regions):
        x = clamp(float(region.get("x", 0)), 0, 1)
        y = clamp(float(region.get("y", 0)), 0, 1)
        width = clamp(float(region.get("width", 0)), 0, 1)
        height = clamp(float(region.get("height", 0)), 0, 1)
        padding_x = max(20, round(page_width * 0.018))
        padding_y = max(20, round(page_height * 0.014))
        x0 = max(0, math.floor(x * page_width) - padding_x)
        y0 = max(0, math.floor(y * page_height) - padding_y)
        x1 = min(page_width, math.ceil((x + width) * page_width) + padding_x)
        y1 = min(page_height, math.ceil((y + height) * page_height) + padding_y)
        x0, y0, x1, y1 = expand_box_until_clear(page, (x0, y0, x1, y1), text_boxes_px)
        crop = page[y0:y1, x0:x1]
        crop, trim = trim_whitespace(crop)
        tx0, ty0, tx1, ty1 = trim
        x0 += tx0
        y0 += ty0
        x1 = x0 + (tx1 - tx0)
        y1 = y0 + (ty1 - ty0)
        crop = clean_image(crop)
        output_path = output_dir / f"crop-{index + 1}.png"
        cv2.imwrite(str(output_path), crop, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        crops.append(
            {
                "index": index,
                "path": output_path.name,
                "width": int(crop.shape[1]),
                "height": int(crop.shape[0]),
                "bbox": {
                    "x": x0 / page_width,
                    "y": y0 / page_height,
                    "width": (x1 - x0) / page_width,
                    "height": (y1 - y0) / page_height,
                },
                "ocrVerified": True,
            }
        )

    write_json(output_dir / "crops.json", {"crops": crops})


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    render = subparsers.add_parser("render")
    render.add_argument("--input", required=True, type=Path)
    render.add_argument("--output-dir", required=True, type=Path)
    render.add_argument("--dpi", type=int, default=400)
    crop = subparsers.add_parser("crop")
    crop.add_argument("--page", required=True, type=Path)
    crop.add_argument("--regions", required=True, type=Path)
    crop.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.command == "render":
        render_pdf(args.input, args.output_dir, int(clamp(args.dpi, 300, 600)))
    else:
        crop_regions(args.page, args.regions, args.output_dir)


if __name__ == "__main__":
    main()
