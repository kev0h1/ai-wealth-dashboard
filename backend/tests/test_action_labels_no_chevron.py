"""G281: server action labels never carry a trailing chevron glyph.

The frontend owns the affordance (a ChevronRight icon via ActionLabel), so a
glyph baked into the label draws two chevrons. Push notification text was
audited too: it has no client icon and no server string there ends in a glyph,
so the same rule applies to it without exception.
"""
import ast
from pathlib import Path

GLYPHS = ("›", ">", "→", "»", "&rsaquo;", "&gt;", "›")
LABEL_KEYS = {"label", "cta", "text", "action_label", "cta_label", "link_label"}
APP = Path(__file__).resolve().parent.parent / "app"


def _bad(value: str) -> bool:
    return value.rstrip().endswith(GLYPHS)


def test_tax_levers_link_has_no_glyph():
    from app.routers.grow import TAX_LEVERS_LINK
    assert not _bad(TAX_LEVERS_LINK["label"])
    assert TAX_LEVERS_LINK["label"] == "See your tax levers"


def test_known_companion_labels_have_no_glyph():
    source = (APP / "services" / "companion.py").read_text()
    for label in ("See what's due", "Review in Planning", "Here's how it went",
                  "See the card", "See the route"):
        assert f'"label": "{label}"' in source
    assert not _bad_literals(APP / "services" / "companion.py")


def _bad_literals(path: Path) -> list[str]:
    """String literals ending in a glyph inside label-like dict entries or
    label-like name/keyword assignments."""
    tree = ast.parse(path.read_text())
    found: list[str] = []

    def tail_literals(node):
        """Literal text that can end the built string: the constant itself, the
        last piece of an f-string, the right side of a + concatenation, the
        template of .format(...) and the left side of % formatting."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, ast.JoinedStr) and node.values:
            yield from tail_literals(node.values[-1])
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            yield from tail_literals(node.right)
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mod):
            yield from tail_literals(node.left)
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and node.func.attr == "format"):
            yield from tail_literals(node.func.value)

    def check(node, where):
        for value in tail_literals(node):
            if _bad(value):
                found.append(f"{path.relative_to(APP.parent)}:{node.lineno} {where} {value!r}")

    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value in LABEL_KEYS:
                    check(v, f"key {k.value!r}")
        elif isinstance(node, ast.keyword) and node.arg in LABEL_KEYS:
            check(node.value, f"kwarg {node.arg}")
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                name = getattr(t, "id", None) or getattr(t, "attr", None) or ""
                if any(k in name.lower() for k in ("label", "cta")):
                    check(node.value, f"assign {name}")
    return found


def test_no_source_literal_ends_in_chevron_glyph():
    offenders: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        offenders += _bad_literals(path)
    assert not offenders, "action label ends in a chevron glyph:\n" + "\n".join(offenders)


def test_guard_detects_a_glyph(tmp_path, monkeypatch):
    p = tmp_path / "app" / "x.py"
    p.parent.mkdir()
    monkeypatch.setitem(globals(), "APP", tmp_path / "app")
    cases = [
        'X = {"label": "See it \u203a", "route": "/a"}',
        'X = {"label": "See it" + " \u203a"}',
        'X = {"label": "See {} \u203a".format(1)}',
        'X = {"label": "See %s \u203a" % 1}',
        'X = {"label": f"See {1} \u203a"}',
        'cta_label = "Go" + " >"',
    ]
    for src in cases:
        p.write_text(src + "\n")
        assert _bad_literals(p), src
    p.write_text('X = {"label": "See it", "route": "/a"}\n')
    assert not _bad_literals(p)
