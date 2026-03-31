"""Extract JSON from LLM responses (markdown fences, extra prose)."""

import re


def extract_json_from_text(text: str) -> str:
    """Strip markdown fences and extract first JSON object or array from LLM output."""
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        idx = text.find(start_char)
        if idx != -1:
            depth = 0
            for i, ch in enumerate(text[idx:], idx):
                if ch == start_char:
                    depth += 1
                elif ch == end_char:
                    depth -= 1
                    if depth == 0:
                        return text[idx : i + 1]
    return text
