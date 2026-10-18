"""Deciding which files to index, and splitting them into chunks with metadata."""

from dataclasses import dataclass
from pathlib import PurePosixPath

from . import config

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache", ".pytest_cache",
    ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "dist", "build", "out", "target", "obj", "coverage",
    ".gradle", ".idea", ".vscode", "Pods", ".dart_tool", "bower_components", "vendor", "site-packages",
    ".ipynb_checkpoints", ".terraform", ".expo", "DerivedData",
}

BINARY_EXT = {
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "icns", "webp", "avif", "tif", "tiff", "psd", "svg",
    "mp3", "mp4", "wav", "ogg", "flac", "mov", "avi", "mkv", "webm", "zip", "tar", "gz", "tgz", "bz2",
    "xz", "7z", "rar", "jar", "war", "apk", "aab", "ipa", "exe", "dll", "so", "dylib", "a", "lib", "o",
    "class", "pyc", "pyd", "wasm", "bin", "woff", "woff2", "ttf", "otf", "eot", "pdf", "doc", "docx",
    "xls", "xlsx", "ppt", "pptx", "db", "sqlite", "sqlite3", "pkl", "npy", "npz", "h5", "onnx", "pt",
    "pth", "ckpt", "safetensors", "parquet", "keystore", "jks", "p12", "glb", "fbx", "blend", "map",
}

LOCK_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Pipfile.lock", "Cargo.lock",
    "composer.lock", "Gemfile.lock", "go.sum", "bun.lockb", "uv.lock", "pubspec.lock",
}

LANGS = {
    "py": "Python", "ipynb": "Jupyter", "js": "JavaScript", "jsx": "JavaScript", "mjs": "JavaScript",
    "cjs": "JavaScript", "ts": "TypeScript", "tsx": "TypeScript", "java": "Java", "kt": "Kotlin",
    "go": "Go", "rs": "Rust", "c": "C", "h": "C", "cpp": "C++", "cc": "C++", "hpp": "C++", "cs": "C#",
    "rb": "Ruby", "php": "PHP", "swift": "Swift", "dart": "Dart", "scala": "Scala", "lua": "Lua",
    "r": "R", "vue": "Vue", "svelte": "Svelte", "html": "HTML", "css": "CSS", "scss": "SCSS",
    "sql": "SQL", "sh": "Shell", "ps1": "PowerShell", "md": "Markdown", "json": "JSON", "yaml": "YAML",
    "yml": "YAML", "toml": "TOML", "xml": "XML", "graphql": "GraphQL", "proto": "Protobuf", "sol": "Solidity",
}


def language_for(path: str) -> str | None:
    name = PurePosixPath(path).name.lower()
    if name == "dockerfile" or name.startswith("dockerfile."):
        return "Dockerfile"
    if name == "makefile":
        return "Makefile"
    return LANGS.get(PurePosixPath(path).suffix.lower().lstrip("."))


def should_index(path: str, size: int) -> bool:
    """Called on the GitHub tree listing, before anything is downloaded."""
    p = PurePosixPath(path)
    if any(part in SKIP_DIRS for part in p.parts[:-1]):
        return False
    if p.name in LOCK_FILES or p.name.endswith((".min.js", ".min.css")):
        return False
    if p.suffix.lower().lstrip(".") in BINARY_EXT:
        return False
    return size <= config.MAX_FILE_KB * 1024


def looks_binary_or_minified(text: str) -> bool:
    if "\0" in text[:8192]:
        return True
    lines = text.count("\n") + 1
    return len(text) > 5000 and len(text) / lines > 400


@dataclass
class Chunk:
    file_name: str
    full_file_path: str
    directory_path: str
    content: str
    start_line: int
    end_line: int

    def embedding_text(self) -> str:
        """What gets embedded: the path gives the model context the code alone lacks."""
        return f"File: {self.full_file_path}\n{self.content}"


def chunk_file(path: str, text: str) -> list[Chunk]:
    """Splits a file into ~CHUNK_LINES-line chunks, preferring to cut where a new top-level block starts."""
    p = PurePosixPath(path)
    file_name, directory_path = p.name, str(p.parent) if str(p.parent) != "." else ""
    lines = text.splitlines()
    size = config.CHUNK_LINES
    chunks, i, n = [], 0, len(lines)
    while i < n:
        end = min(n, i + size)
        if end < n:
            # Look for a blank line followed by an unindented line (usually a new function/class).
            for j in range(min(n - 1, i + size + size // 3), i + size // 2, -1):
                if lines[j].strip() and not lines[j][0].isspace() and not lines[j - 1].strip():
                    end = j
                    break
        body = "\n".join(lines[i:end])
        if body.strip():
            chunks.append(Chunk(file_name, path, directory_path, body, i + 1, end))
        i = end
    return chunks
