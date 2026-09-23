"""Render the #2886 report markdown into the artifact HTML (out/street-side.html) using artifact_shell.html for the
head and styles, tables wrapped for horizontal scroll and the figures inlined as base64. Run in the web container:
    python3.13 tools/street_side/render_artifact.py
"""
import base64, re
from pathlib import Path
import markdown
HERE = Path(__file__).resolve().parent
DOC = HERE.parents[1] / "docs" / "experiments" / "2026-09-03-street-side-assignment.md"
html = markdown.markdown(DOC.read_text(), extensions=["tables", "fenced_code"])
html = html.replace("<table>", '<div class="tbl"><table>').replace("</table>", "</table></div>")
def inline(m):
    data = base64.b64encode((DOC.parent / m.group(1)).read_bytes()).decode()
    return f'src="data:image/png;base64,{data}"'
html = re.sub(r'src="(2886-street-side/[^"]+)"', inline, html)
shell = (HERE / "artifact_shell.html").read_text()
(HERE / "out" / "street-side.html").write_text(shell + "\n" + html + "\n</div>\n")
print("rendered", len(html))
