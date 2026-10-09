import { ChevronDown, Folder } from "lucide-react";
import DocumentCard from "./DocumentCard.jsx";

function countFiles(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "folder") n += countFiles(node.children);
    else n++;
  }
  return n;
}

/**
 * Recursively renders the folder tree of a subject. Files become DocumentCards;
 * nested Google Drive sub-folders become collapsible <details> groups so every
 * document in the original folder stays reachable.
 */
export default function FileTree({ nodes, onPreview, depth = 0 }) {
  const files = nodes.filter((n) => n.type === "file");
  const folders = nodes.filter((n) => n.type === "folder");

  return (
    <>
      {files.length > 0 ? (
        <div className="doc-grid">
          {files.map((file) => (
            <DocumentCard key={file.fileId} file={file} onPreview={onPreview} />
          ))}
        </div>
      ) : null}

      {folders.map((folder) => {
        const total = countFiles(folder.children);
        return (
          <details
            className="folder-group"
            key={folder.fileId}
            open={depth === 0}
          >
            <summary>
              <Folder
                className="folder-icon"
                size={17}
                aria-hidden="true"
              />
              {folder.title}
              <span className="folder-count">
                {total} {total === 1 ? "file" : "files"}
              </span>
              <ChevronDown className="folder-caret" size={16} aria-hidden="true" />
            </summary>
            <div className="folder-group-body">
              <FileTree
                nodes={folder.children}
                onPreview={onPreview}
                depth={depth + 1}
              />
            </div>
          </details>
        );
      })}
    </>
  );
}
