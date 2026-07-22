import os
import git
from tree_sitter import Language, Parser
import tree_sitter_python as tspython

# Initialize Tree-sitter for Python
PY_LANGUAGE = Language(tspython.language())
parser = Parser(PY_LANGUAGE)

def clone_and_extract(repo_url: str):
    repo_name = repo_url.split("/")[-1].replace(".git", "")
    clone_dir = f"./tmp_{repo_name}"
    
    # Clone Repo
    if not os.path.exists(clone_dir):
        print(f"Cloning {repo_url}...")
        git.Repo.clone_from(repo_url, clone_dir)
    
    chunks = []
    # Traverse directory
    for root, _, files in os.walk(clone_dir):
        if ".git" in root or "venv" in root:
            continue
            
        for file in files:
            if file.endswith(".py"):
                file_path = os.path.join(root, file)
                with open(file_path, "r", encoding="utf-8") as f:
                    code = f.read()
                
                # Parse AST
                tree = parser.parse(bytes(code, "utf8"))
                root_node = tree.root_node
                
                # Extract functions and classes
                for node in root_node.children:
                    if node.type in ["function_definition", "class_definition"]:
                        chunk_text = code[node.start_byte:node.end_byte]
                        chunks.append({
                            "text": chunk_text,
                            "file": file_path
                        })
    return chunks