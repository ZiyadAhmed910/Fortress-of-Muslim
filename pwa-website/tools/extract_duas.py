import json
import os
import re
from collections import Counter
from pathlib import Path

from docx import Document


ROOT = Path(__file__).resolve().parents[2]
DOCX_PATH = ROOT / "Fortress_of_Muslim.docx"
OUT_PATH = ROOT / "pwa-website" / "data" / "duas.json"

ARABIC_RE = re.compile(r"[\u0600-\u06ff]")
LATIN_RE = re.compile(r"[A-Za-z]")
HEADING_RE = re.compile(r"^(\d+)\.\s*(.*?)\s*-\[(.*)$")


def letter_counts(text):
    return len(ARABIC_RE.findall(text)), len(LATIN_RE.findall(text))


def clean(text):
    text = text.strip()
    text = re.sub(r"^,+\s*", "", text)
    text = text.replace("[", "").replace("]", "")
    return text.strip(" \t\r\n,")


def strong_kind(char):
    if ARABIC_RE.match(char):
        return "arabic"
    if LATIN_RE.match(char) or char in "‘’“”'\"":
        return "latin"
    return None


def split_arabic_latin(text):
    text = clean(text)
    if not text:
        return []

    arabic_count, latin_count = letter_counts(text)
    if arabic_count == 0:
        return [text]

    # Keep ordinary English notes with short Arabic honorifics intact.
    first_strong = next((strong_kind(char) for char in text if strong_kind(char)), None)
    should_split = first_strong == "arabic" or arabic_count >= 20 or arabic_count >= latin_count
    if not should_split:
        return [text]

    parts = []
    current = []
    current_kind = None

    for char in text:
        kind = strong_kind(char)
        if kind and current_kind and kind != current_kind:
            piece = clean("".join(current))
            if piece:
                parts.append(piece)
            current = [char]
            current_kind = kind
            continue
        current.append(char)
        if kind:
            current_kind = kind

    piece = clean("".join(current))
    if piece:
        parts.append(piece)
    return parts


def split_comment_tail(text):
    markers = [
        "and then supplicates:",
        "instead, one should say:",
        "one says:",
        "he would say:",
        "then say:",
        "and say:",
    ]
    lower = text.lower()
    for marker in markers:
        pos = lower.rfind(marker)
        if pos > 18:
            before = clean(text[:pos])
            after = clean(text[pos:])
            return [part for part in (before, after) if part]
    return [text]


def classify_text(text):
    arabic_count, latin_count = letter_counts(text)
    stripped = text.strip()
    lower = stripped.lower()

    if arabic_count and arabic_count >= max(5, latin_count):
        return "arabic"

    transliteration_hints = (
        "allahumma",
        "alhamdu",
        "subhana",
        "bismil",
        "la ilaha",
        "rabb",
        "ashhadu",
        "aaoothu",
        "ghufranak",
        "inna fee",
        "wa-",
    )
    comment_hints = (
        "the prophet",
        "one repeats",
        "immediately following",
        "one should",
        "when he",
        "jabir said",
        "ibn ",
        "abu ",
        "the messenger",
        "al-waleed said",
    )

    if lower.endswith(":") or lower.startswith(comment_hints):
        return "comment"
    if lower.startswith(transliteration_hints) or stripped.startswith("'Inna"):
        return "transliteration"
    if stripped.startswith(("‘", "“", '"')) or lower.startswith(
        (
            "o allah",
            "all praise",
            "none has",
            "there is",
            "may you",
            "in the name",
            "how perfect",
            "verily",
            "i take",
            "i bear",
            "wear anew",
        )
    ):
        return "translation"
    return "transliteration"


def extract_entries():
    document = Document(DOCX_PATH)
    entries = []
    current = None

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue

        match = HEADING_RE.match(text)
        if match:
            if current:
                entries.append(current)
            current = {
                "id": int(match.group(1)),
                "title": clean(match.group(2)),
                "raw": [],
            }
            remainder = clean(match.group(3))
            if remainder:
                current["raw"].append(remainder)
            continue

        if current:
            current["raw"].append(text)

    if current:
        entries.append(current)
    return entries


def chunks_for(raw_lines):
    chunks = []
    for raw in raw_lines:
        for mixed_piece in split_arabic_latin(raw):
            for piece in split_comment_tail(mixed_piece):
                piece = clean(piece)
                if piece:
                    chunks.append({"kind": classify_text(piece), "text": piece})
    return chunks


def normalize_part(part):
    # User-facing order: English comment, Arabic, transliteration, translation.
    order = {"comment": 0, "arabic": 1, "transliteration": 2, "translation": 3}
    normalized = []
    for kind in ("comment", "arabic", "transliteration", "translation"):
        texts = [segment["text"] for segment in part if segment["kind"] == kind]
        for text in texts:
            normalized.append({"kind": kind, "text": text})
    return sorted(normalized, key=lambda segment: order[segment["kind"]])


def parts_for(raw_lines):
    chunks = chunks_for(raw_lines)
    parts = []
    current = []

    def has(kind):
        return any(segment["kind"] == kind for segment in current)

    def complete():
        return has("arabic") and has("transliteration") and has("translation")

    def append_as(chunk, kind):
        current.append({"kind": kind, "text": chunk["text"]})

    for chunk in chunks:
        kind = chunk["kind"]

        if kind == "arabic":
            if has("arabic"):
                parts.append(normalize_part(current))
                current = []
            current.append(chunk)
            continue

        if kind == "comment":
            if current and complete():
                parts.append(normalize_part(current))
                current = []
            current.append(chunk)
            continue

        if kind == "transliteration":
            if current and complete():
                parts.append(normalize_part(current))
                current = []
            if has("arabic") and has("transliteration") and not has("translation"):
                append_as(chunk, "translation")
            elif has("arabic") and has("translation") and not has("transliteration"):
                append_as(chunk, "transliteration")
            elif not has("arabic"):
                append_as(chunk, "comment")
            else:
                current.append(chunk)
            continue

        if kind == "translation":
            if current and complete():
                parts.append(normalize_part(current))
                current = []
            current.append(chunk)
            if has("arabic") and has("transliteration"):
                parts.append(normalize_part(current))
                current = []
            continue

    if current:
        parts.append(normalize_part(current))

    return [part for part in parts if part]


def main():
    entries = extract_entries()
    duplicates = Counter(entry["id"] for entry in entries)

    for sequence, entry in enumerate(entries, 1):
        entry["uid"] = f"dua-{sequence:03d}"
        entry["sequence"] = sequence
        entry["duplicateId"] = duplicates[entry["id"]] > 1
        entry["parts"] = parts_for(entry.pop("raw"))
        entry["searchText"] = " ".join(
            [entry["title"]]
            + [segment["text"] for part in entry["parts"] for segment in part]
        ).lower()

    output = {
        "generatedFrom": os.path.basename(DOCX_PATH),
        "count": len(entries),
        "entries": entries,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(entries)} entries to {OUT_PATH}")


if __name__ == "__main__":
    main()
