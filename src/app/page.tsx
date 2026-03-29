"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  pickDirectory,
  filesFromInput,
  canWrite,
  listFiles,
  listFilesRecursive,
  buildDirectoryTree,
  readFile,
  saveFile,
  downloadFile,
  detectDuplicates,
  type DirectorySource,
  type FileMetadata,
  type FileContent,
  type DuplicateGroup,
  type DirectoryTreeNode,
} from "./lib/fs-service";

/* ─── Types ─── */
interface Toast {
  message: string;
  type: "success" | "error";
}

type ScanScope = "current" | "recursive";

/* ─── Helpers ─── */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/* ─── Tree View Component ─── */
function TreeNode({
  node,
  selectedFile,
  onSelectFile,
  expandedDirs,
  onToggleDir,
  depth = 0,
}: {
  node: DirectoryTreeNode;
  selectedFile: FileContent | null;
  onSelectFile: (slug: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {/* Render child directories */}
      {node.children.map((child) => {
        const isExpanded = expandedDirs.has(child.path);
        const totalFiles = countFiles(child);
        return (
          <div key={child.path} className="tree-branch">
            <div
              className={`tree-dir-item${isExpanded ? " expanded" : ""}`}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              onClick={() => onToggleDir(child.path)}
            >
              <span className="material-symbols-outlined tree-chevron">
                chevron_right
              </span>
              <span className="material-symbols-outlined tree-folder-icon">
                {isExpanded ? "folder_open" : "folder"}
              </span>
              <span className="tree-dir-name">{child.name}</span>
              <span className="tree-dir-count">{totalFiles}</span>
            </div>
            {isExpanded && (
              <div className="tree-children">
                <TreeNode
                  node={child}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  expandedDirs={expandedDirs}
                  onToggleDir={onToggleDir}
                  depth={depth + 1}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Render files in this directory */}
      {node.files.map((file) => (
        <div
          key={file.slug}
          id={`file-${file.slug.replace(/\//g, "-")}`}
          className={`tree-file-item${selectedFile?.slug === file.slug ? " active" : ""}`}
          style={{ paddingLeft: `${12 + (depth + (node.path ? 0 : 0)) * 16 + (node.path ? 16 : 0)}px` }}
          onClick={() => onSelectFile(file.slug)}
        >
          <span className="material-symbols-outlined tree-file-icon">description</span>
          <div className="tree-file-info">
            <div className="tree-file-name">{file.name}</div>
            <div className="tree-file-meta">
              <span>{formatDate(file.modifiedAt)}</span>
              <span>·</span>
              <span>{formatSize(file.size)}</span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function countFiles(node: DirectoryTreeNode): number {
  let count = node.files.length;
  for (const child of node.children) {
    count += countFiles(child);
  }
  return count;
}

/* ─── Main Page ─── */
export default function Home() {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<FileMetadata[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─── Directory Source ─── */
  const [source, setSource] = useState<DirectorySource | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  /* ─── Scan Scope ─── */
  const [scanScope, setScanScope] = useState<ScanScope | null>(null);
  const [directoryTree, setDirectoryTree] = useState<DirectoryTreeNode | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  /* ─── Data Loading ─── */
  const loadData = useCallback(async (src: DirectorySource, scope: ScanScope) => {
    setLoading(true);
    try {
      const listFn = scope === "recursive" ? listFilesRecursive : listFiles;
      const [fileList, groups] = await Promise.all([
        listFn(src),
        detectDuplicates(src),
      ]);
      setFiles(fileList);
      setFilteredFiles(fileList);
      setDuplicates(groups);

      if (scope === "recursive") {
        const tree = buildDirectoryTree(fileList, src.name);
        setDirectoryTree(tree);
        // Auto-expand root-level directories
        const rootPaths = new Set(tree.children.map((c) => c.path));
        setExpandedDirs(rootPaths);
      } else {
        setDirectoryTree(null);
      }
    } catch {
      showToast("Erro ao carregar arquivos", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const selectFile = useCallback(async (slug: string) => {
    if (!source) return;
    setFileLoading(true);
    setIsEditing(false);
    try {
      const data = await readFile(source, slug);
      setSelectedFile(data);
      setEditContent(data.content);
    } catch {
      showToast("Erro ao abrir arquivo", "error");
    } finally {
      setFileLoading(false);
    }
  }, [source]);

  const handleSave = useCallback(async () => {
    if (!selectedFile || !source) return;

    if (canWrite(source)) {
      try {
        await saveFile(source, selectedFile.slug, editContent);
        setSelectedFile({ ...selectedFile, content: editContent });
        setIsEditing(false);
        showToast("Arquivo salvo com sucesso", "success");
        if (scanScope) loadData(source, scanScope);
      } catch {
        showToast("Erro ao salvar. Tentando download...", "error");
        downloadFile(selectedFile.slug, editContent);
      }
    } else {
      downloadFile(selectedFile.slug, editContent);
      setSelectedFile({ ...selectedFile, content: editContent });
      setIsEditing(false);
      showToast("Arquivo baixado (modo somente leitura)", "success");
    }
  }, [selectedFile, editContent, source, scanScope, loadData]);

  /* ─── Directory Selection ─── */
  const openDirectory = useCallback(async () => {
    try {
      const src = await pickDirectory();
      setSource(src);
      setReadOnly(!canWrite(src));
      setSelectedFile(null);
      setIsEditing(false);
      setScanScope(null);
      setDirectoryTree(null);
      showToast(`Diretório "${src.name}" aberto`, "success");
    } catch (err) {
      const error = err as Error;
      if (error.name === "AbortError") return;
      if (error.message === "BLOCKED_DIRECTORY") {
        fileInputRef.current?.click();
      } else {
        showToast("Erro ao selecionar diretório", "error");
      }
    }
  }, []);

  const handleFallbackInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const src = filesFromInput(fileList);
    setSource(src);
    setReadOnly(true);
    setSelectedFile(null);
    setIsEditing(false);
    setScanScope(null);
    setDirectoryTree(null);
    const fileCount = src.type === "files" ? src.files.size : 0;
    showToast(
      `Diretório "${src.name}" aberto em modo leitura (${fileCount} arquivo(s) .md)`,
      "success",
      5000,
    );
    e.target.value = "";
  }, []);

  const changeDir = useCallback(() => {
    setSource(null);
    setSelectedFile(null);
    setIsEditing(false);
    setFiles([]);
    setFilteredFiles([]);
    setDuplicates([]);
    setReadOnly(false);
    setScanScope(null);
    setDirectoryTree(null);
    setExpandedDirs(new Set());
  }, []);

  const reloadFiles = useCallback(() => {
    if (source && scanScope) {
      if (source.type === "handle") {
        loadData(source, scanScope);
        showToast("Arquivos recarregados", "success");
      } else {
        showToast("Recarregamento automático apenas para diretórios nativos", "error");
      }
    }
  }, [source, scanScope, loadData]);

  const selectScope = useCallback((scope: ScanScope) => {
    setScanScope(scope);
  }, []);

  /* ─── Toggle tree directories ─── */
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  /* ─── Search ─── */
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      searchTimeoutRef.current = setTimeout(() => {
        if (!query.trim()) {
          setFilteredFiles(files);
          // Rebuild tree if in recursive mode
          if (scanScope === "recursive" && source) {
            const tree = buildDirectoryTree(files, source.name);
            setDirectoryTree(tree);
          }
          return;
        }
        const q = query.toLowerCase();
        const filtered = files.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.slug.toLowerCase().includes(q) ||
            f.excerpt.toLowerCase().includes(q)
        );
        setFilteredFiles(filtered);
        // Rebuild tree with filtered results
        if (scanScope === "recursive" && source) {
          const tree = buildDirectoryTree(filtered, source.name);
          setDirectoryTree(tree);
          // Expand all directories to show search results
          const allPaths = new Set<string>();
          function collectPaths(node: DirectoryTreeNode) {
            if (node.path) allPaths.add(node.path);
            node.children.forEach(collectPaths);
          }
          collectPaths(tree);
          setExpandedDirs(allPaths);
        }
      }, 300);
    },
    [files, scanScope, source]
  );

  /* ─── Toast ─── */
  const showToast = (message: string, type: "success" | "error", duration = 3000) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  };

  /* ─── Effects ─── */
  useEffect(() => {
    if (source && scanScope) loadData(source, scanScope);
  }, [source, scanScope, loadData]);

  /* ─── Hidden file input for fallback ─── */
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      // @ts-expect-error — webkitdirectory is a non-standard attribute
      webkitdirectory="true"
      multiple
      style={{ display: "none" }}
      onChange={handleFallbackInput}
    />
  );

  /* ─── Directory Picker Screen ─── */
  if (!source) {
    return (
      <div className="dir-picker-screen">
        {hiddenInput}
        <div className="dir-picker-card">
          <div className="dir-picker-icon">
            <span className="material-symbols-outlined">auto_stories</span>
          </div>
          <h1 className="dir-picker-title">MD Manager</h1>
          <p className="dir-picker-desc">
            Selecione o diretório que contém seus arquivos Markdown para começar.
          </p>
          <button
            id="btn-open-dir"
            className="btn btn-primary btn-lg"
            onClick={openDirectory}
          >
            <span className="material-symbols-outlined">folder_open</span>
            Selecionar Diretório
          </button>
          <button
            id="btn-open-fallback"
            className="btn btn-lg"
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="material-symbols-outlined">upload_file</span>
            Carregar Arquivos (somente leitura)
          </button>
          <p className="dir-picker-hint">
            Use &quot;Carregar Arquivos&quot; para pastas do sistema como Downloads e Documentos.
          </p>
        </div>

        {toast && (
          <div className={`toast ${toast.type}`}>
            <span className="material-symbols-outlined">
              {toast.type === "success" ? "check_circle" : "error"}
            </span>
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  /* ─── Scope Selection Screen ─── */
  if (!scanScope) {
    return (
      <div className="dir-picker-screen">
        {hiddenInput}
        <div className="scope-picker-card">
          <div className="scope-picker-header">
            <div className="scope-picker-icon">
              <span className="material-symbols-outlined">folder_open</span>
            </div>
            <h2 className="scope-picker-title">{source.name}</h2>
            <p className="scope-picker-desc">
              Como deseja listar os arquivos Markdown?
            </p>
          </div>

          <div className="scope-options">
            <button
              id="btn-scope-current"
              className="scope-option-card"
              onClick={() => selectScope("current")}
            >
              <div className="scope-option-icon">
                <span className="material-symbols-outlined">folder</span>
              </div>
              <div className="scope-option-content">
                <h3>Diretório Atual</h3>
                <p>Listar apenas os arquivos <code>.md</code> na raiz do diretório selecionado.</p>
              </div>
              <span className="material-symbols-outlined scope-option-arrow">arrow_forward</span>
            </button>

            <button
              id="btn-scope-recursive"
              className="scope-option-card"
              onClick={() => selectScope("recursive")}
            >
              <div className="scope-option-icon">
                <span className="material-symbols-outlined">account_tree</span>
              </div>
              <div className="scope-option-content">
                <h3>Incluir Subdiretórios</h3>
                <p>Listar todos os arquivos <code>.md</code> do diretório e seus subdiretórios em árvore.</p>
              </div>
              <span className="material-symbols-outlined scope-option-arrow">arrow_forward</span>
            </button>
          </div>

          <button
            id="btn-scope-back"
            className="btn scope-back-btn"
            onClick={changeDir}
          >
            <span className="material-symbols-outlined">arrow_back</span>
            Escolher outro diretório
          </button>
        </div>

        {toast && (
          <div className={`toast ${toast.type}`}>
            <span className="material-symbols-outlined">
              {toast.type === "success" ? "check_circle" : "error"}
            </span>
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  /* ─── Main App ─── */
  return (
    <div className={`app-layout${showDuplicates ? " with-panel" : ""}`}>
      {hiddenInput}

      {/* ═══ SIDEBAR ═══ */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="material-symbols-outlined">auto_stories</span>
            <h1>MD Manager</h1>
          </div>
          <div className="search-wrapper">
            <span className="material-symbols-outlined">search</span>
            <input
              id="search-input"
              type="text"
              className="search-input"
              placeholder="Buscar por nome ou conteúdo..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="sidebar-toolbar">
          <span className="file-count">
            {filteredFiles.length} arquivo{filteredFiles.length !== 1 ? "s" : ""}
            {scanScope === "recursive" && (
              <span className="scope-badge">
                <span className="material-symbols-outlined icon-xs">account_tree</span>
                árvore
              </span>
            )}
          </span>
          <div className="toolbar-actions">
            <button
              id="btn-reload-files"
              className="toolbar-btn"
              onClick={reloadFiles}
              title="Recarregar arquivos"
            >
              <span className="material-symbols-outlined icon-sm">refresh</span>
            </button>
            <button
              id="btn-change-dir"
              className="toolbar-btn"
              onClick={changeDir}
              title="Alterar diretório"
            >
              <span className="material-symbols-outlined icon-sm">folder_open</span>
            </button>
            <button
              id="btn-duplicates"
              className={`toolbar-btn${showDuplicates ? " active" : ""}`}
              onClick={() => setShowDuplicates(!showDuplicates)}
              title="Detectar duplicatas"
            >
              <span className="material-symbols-outlined icon-sm">content_copy</span>
            </button>
          </div>
        </div>

        {/* Directory indicator */}
        <div className="dir-indicator" title={source.name}>
          <span className="material-symbols-outlined icon-sm">folder</span>
          <span className="dir-indicator-path">{source.name}</span>
          {readOnly && <span className="badge badge-readonly">somente leitura</span>}
        </div>

        <div className="file-list">
          {loading ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="empty-state" style={{ padding: "20px" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "36px" }}>
                search_off
              </span>
              <p>Nenhum arquivo encontrado</p>
            </div>
          ) : scanScope === "recursive" && directoryTree ? (
            /* ─── Tree View ─── */
            <div className="tree-view">
              <TreeNode
                node={directoryTree}
                selectedFile={selectedFile}
                onSelectFile={selectFile}
                expandedDirs={expandedDirs}
                onToggleDir={toggleDir}
              />
            </div>
          ) : (
            /* ─── Flat View ─── */
            filteredFiles.map((file) => (
              <div
                key={file.slug}
                id={`file-${file.slug}`}
                className={`file-item${selectedFile?.slug === file.slug ? " active" : ""}`}
                onClick={() => selectFile(file.slug)}
              >
                <span className="material-symbols-outlined file-icon">description</span>
                <div className="file-info">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">
                    <span>{formatDate(file.modifiedAt)}</span>
                    <span>·</span>
                    <span>{formatSize(file.size)}</span>
                  </div>
                  {file.excerpt && <div className="file-excerpt">{file.excerpt}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="main-content">
        {selectedFile ? (
          <>
            <div className="content-header">
              <h2 className="content-title">
                {files.find((f) => f.slug === selectedFile.slug)?.name || selectedFile.slug}
              </h2>
              <div className="content-actions">
                {isEditing ? (
                  <>
                    <button id="btn-cancel" className="btn" onClick={() => {
                      setIsEditing(false);
                      setEditContent(selectedFile.content);
                    }}>
                      <span className="material-symbols-outlined">close</span>
                      Cancelar
                    </button>
                    <button id="btn-save" className="btn btn-primary" onClick={handleSave}>
                      <span className="material-symbols-outlined">
                        {readOnly ? "download" : "save"}
                      </span>
                      {readOnly ? "Baixar" : "Salvar"}
                    </button>
                  </>
                ) : (
                  <button id="btn-edit" className="btn" onClick={() => setIsEditing(true)}>
                    <span className="material-symbols-outlined">edit</span>
                    Editar
                  </button>
                )}
              </div>
            </div>

            {fileLoading ? (
              <div className="loading-spinner" style={{ flex: 1 }}>
                <div className="spinner"></div>
              </div>
            ) : isEditing ? (
              <div className="editor-container">
                <div className="editor-pane">
                  <div className="editor-pane-header">
                    <span className="material-symbols-outlined">code</span>
                    Markdown
                    {readOnly && (
                      <span className="badge badge-readonly" style={{ marginLeft: "auto" }}>
                        alterações serão baixadas
                      </span>
                    )}
                  </div>
                  <textarea
                    id="editor-textarea"
                    className="editor-textarea"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    placeholder="Escreva seu markdown aqui..."
                    spellCheck={false}
                  />
                </div>
                <div className="editor-pane">
                  <div className="editor-pane-header">
                    <span className="material-symbols-outlined">visibility</span>
                    Preview
                  </div>
                  <div className="editor-preview">
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                        {editContent}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="content-body fade-in">
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {selectedFile.content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <span className="material-symbols-outlined">menu_book</span>
            <h3>Selecione um documento</h3>
            <p>
              Escolha um arquivo markdown na barra lateral para visualizar seu conteúdo.
            </p>
          </div>
        )}
      </main>

      {/* ═══ DUPLICATES PANEL ═══ */}
      {showDuplicates && (
        <aside className="duplicates-panel fade-in">
          <div className="panel-header">
            <h2>
              <span className="material-symbols-outlined">content_copy</span>
              Duplicatas
            </h2>
            <button
              className="toolbar-btn"
              onClick={() => setShowDuplicates(false)}
            >
              <span className="material-symbols-outlined icon-sm">close</span>
            </button>
          </div>
          <div className="panel-body">
            {duplicates.length === 0 ? (
              <div className="empty-state" style={{ gap: "10px" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "36px" }}>
                  check_circle
                </span>
                <p>Nenhuma duplicata detectada</p>
              </div>
            ) : (
              duplicates.map((group, idx) => (
                <div key={idx} className="duplicate-group">
                  <div className="similarity-label">
                    <span>Similaridade</span>
                    <span>{group.similarity}%</span>
                  </div>
                  <div className="similarity-bar-track">
                    <div
                      className={`similarity-bar-fill ${
                        group.similarity >= 75 ? "similarity-high" : "similarity-medium"
                      }`}
                      style={{ width: `${group.similarity}%` }}
                    ></div>
                  </div>
                  {group.files.map((file) => (
                    <div
                      key={file.slug}
                      className="duplicate-file"
                      onClick={() => selectFile(file.slug)}
                    >
                      <span className="material-symbols-outlined">description</span>
                      {file.name}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* ═══ TOAST ═══ */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <span className="material-symbols-outlined">
            {toast.type === "success" ? "check_circle" : "error"}
          </span>
          {toast.message}
        </div>
      )}
    </div>
  );
}
