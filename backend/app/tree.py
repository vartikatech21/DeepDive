"""Builds the directory tree string used as global context in every prompt."""

from collections import defaultdict


def build_tree(paths: list[str], root: str) -> str:
    """Renders paths as an ASCII tree:

    repo/
    ├── src/
    │   ├── app.py
    │   └── utils.py
    └── README.md
    """
    children: dict[str, set[str]] = defaultdict(set)
    is_dir: set[str] = set()
    for path in paths:
        parts = path.split("/")
        for i in range(len(parts)):
            parent = "/".join(parts[:i])
            node = "/".join(parts[: i + 1])
            children[parent].add(node)
            if i < len(parts) - 1:
                is_dir.add(node)

    lines = [f"{root}/"]

    def walk(folder: str, prefix: str) -> None:
        # Folders first, then files, both alphabetical.
        items = sorted(children.get(folder, ()), key=lambda n: (n not in is_dir, n.lower()))
        for idx, node in enumerate(items):
            last = idx == len(items) - 1
            name = node.rsplit("/", 1)[-1] + ("/" if node in is_dir else "")
            lines.append(f"{prefix}{'└── ' if last else '├── '}{name}")
            if node in is_dir:
                walk(node, prefix + ("    " if last else "│   "))

    walk("", "")
    return "\n".join(lines)


def fit_tree(tree: str, budget: int) -> str:
    """Shortens a tree to fit the prompt budget, dropping the deepest levels first so every folder stays visible."""
    if len(tree) <= budget:
        return tree
    lines = tree.splitlines()
    for max_depth in range(12, -1, -1):
        kept = [l for l in lines if _depth(l) <= max_depth]
        text = "\n".join(kept)
        if len(text) <= budget:
            return text + f"\n… (deeper levels hidden; {len(lines) - 1} entries in total)"
    return "\n".join(lines)[:budget] + "\n… (truncated)"


def _depth(line: str) -> int:
    # Each level of nesting adds a 4-character prefix ("│   " or "    ") before the "├── " marker.
    stripped = line.lstrip("│ ")
    return (len(line) - len(stripped)) // 4
