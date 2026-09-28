#!/usr/bin/env python3
"""Build the internal security test report: Markdown -> HTML -> PDF (A111).

Converts docs/security/reports/internal-security-test-report-2026-09.md
to a standalone HTML file with an embedded print stylesheet, then renders
that HTML to PDF with headless Chrome. Both outputs are written next to
the Markdown source by default.

Usage:
    backend/.venv/bin/python scripts/build_security_report.py
    backend/.venv/bin/python scripts/build_security_report.py \
        --source docs/security/reports/internal-security-test-report-2026-09.md \
        --out docs/security/reports/internal-security-test-report-2026-09.pdf

Requires the `markdown` package (present in backend/.venv) and a
`google-chrome` binary on PATH.
"""

from __future__ import annotations

import argparse
import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT / "docs/security/reports/internal-security-test-report-2026-09.md"

PRINT_CSS = """
@page {
  size: A4;
  margin: 22mm 16mm 20mm 16mm;
  @bottom-right {
    content: "Page " counter(page) " of " counter(pages);
    font-size: 9px;
    color: #666666;
  }
}

:root {
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

body {
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 11px;
  line-height: 1.5;
  color: #1a1a1a;
  background: #ffffff;
  margin: 0;
  padding: 0;
}

.report-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 2px solid #1a1a1a;
  padding-bottom: 6px;
  margin-bottom: 18px;
  font-family: "Helvetica Neue", Arial, sans-serif;
}

.report-header-bar .report-id {
  font-size: 10px;
  color: #444444;
  letter-spacing: 0.02em;
}

.report-header-bar .draft-flag {
  font-size: 11px;
  font-weight: 700;
  color: #8a1f11;
  border: 1px solid #8a1f11;
  padding: 1px 8px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.report-body {
  max-width: 100%;
}

h1, h2, h3, h4 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  color: #111111;
  page-break-after: avoid;
}

h1 {
  font-size: 20px;
  margin: 0 0 10px 0;
}

h2 {
  font-size: 15px;
  margin: 26px 0 10px 0;
  border-bottom: 1px solid #cccccc;
  padding-bottom: 4px;
}

h3 {
  font-size: 12.5px;
  margin: 16px 0 6px 0;
}

h4 {
  font-size: 11.5px;
  margin: 12px 0 4px 0;
}

p {
  margin: 0 0 10px 0;
  orphans: 3;
  widows: 3;
}

strong {
  font-weight: 700;
}

blockquote {
  margin: 10px 0 14px 0;
  padding: 8px 14px;
  border-left: 3px solid #8a1f11;
  background: #f7f2f0;
  font-style: italic;
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5px;
}

code {
  font-family: "Menlo", "Consolas", monospace;
  font-size: 9.5px;
  background: #f0f0f0;
  padding: 0 3px;
  border-radius: 2px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0 16px 0;
  font-size: 9.5px;
  page-break-inside: auto;
}

table tr {
  page-break-inside: avoid;
}

thead {
  display: table-header-group;
}

th, td {
  border: 1px solid #999999;
  padding: 4px 6px;
  text-align: left;
  vertical-align: top;
}

th {
  background: #eeeeee;
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-weight: 700;
}

hr {
  border: none;
  border-top: 1px solid #cccccc;
  margin: 20px 0;
}

ul, ol {
  margin: 0 0 10px 0;
  padding-left: 20px;
}

li {
  margin-bottom: 3px;
}
"""

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<div class="report-header-bar">
  <span class="report-id">{report_id} &middot; Confidential, prepared for Finexer</span>
  <span class="draft-flag">Draft</span>
</div>
<div class="report-body">
{body}
</div>
</body>
</html>
"""

REPORT_ID_RE = re.compile(r"\*\*Report id:\*\*\s*(\S+)")


def markdown_to_html(source: Path) -> str:
    try:
        import markdown
    except ImportError as exc:  # pragma: no cover - environment guard
        raise SystemExit(
            "the 'markdown' package is required; run with backend/.venv/bin/python"
        ) from exc

    text = source.read_text(encoding="utf-8")
    report_id_match = REPORT_ID_RE.search(text)
    report_id = report_id_match.group(1) if report_id_match else "AURIQ-SEC-RPT"

    body_html = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists"],
    )

    title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    title = html.escape(title_match.group(1)) if title_match else "Security test report"

    return HTML_TEMPLATE.format(
        title=title,
        css=PRINT_CSS,
        report_id=html.escape(report_id),
        body=body_html,
    )


def find_chrome() -> str:
    for candidate in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
        path = shutil.which(candidate)
        if path:
            return path
    raise SystemExit("no google-chrome/chromium binary found on PATH")


def render_pdf(html_path: Path, pdf_path: Path) -> None:
    chrome = find_chrome()
    cmd = [
        chrome,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        f"--print-to-pdf={pdf_path}",
        "--no-pdf-header-footer",
        "--virtual-time-budget=4000",
        f"file://{html_path}",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(f"chrome PDF render failed with exit code {result.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Markdown source path (default: %(default)s)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output PDF path (default: same name as --source with a .pdf extension)",
    )
    args = parser.parse_args()

    source = args.source.resolve()
    if not source.is_file():
        raise SystemExit(f"source not found: {source}")

    out_pdf = (args.out or source.with_suffix(".pdf")).resolve()
    out_html = out_pdf.with_suffix(".html")

    html_doc = markdown_to_html(source)
    out_html.write_text(html_doc, encoding="utf-8")
    print(f"wrote {out_html}")

    render_pdf(out_html, out_pdf)
    print(f"wrote {out_pdf}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
