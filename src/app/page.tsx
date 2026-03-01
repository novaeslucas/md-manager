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
  readFile,
  saveFile,
  downloadFile,
  detectDuplicates,
  type DirectorySource,
  type FileMetadata,
  type FileContent,
  type DuplicateGroup,
} from "./lib/fs-service";

/* ─── Types ─── */
interface Toast {
  message: string;
  type: "success" | "error";
}

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

  /* ─── Data Loading ─── */
  const loadData = useCallback(async (src: DirectorySource) => {
    setLoading(true);
    try {
      const [fileList, groups] = await Promise.all([
        listFiles(src),
        detectDuplicates(src),
      ]);
      setFiles(fileList);
      setFilteredFiles(fileList);
      setDuplicates(groups);
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
        loadData(source);
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
  }, [selectedFile, editContent, source, loadData]);

  /* ─── Directory Selection ─── */
  const openDirectory = useCallback(async () => {
    try {
      const src = await pickDirectory();
      setSource(src);
      setReadOnly(!canWrite(src));
      setSelectedFile(null);
      setIsEditing(false);
      showToast(`Diretório "${src.name}" aberto`, "success");
    } catch (err) {
      const error = err as Error;
      if (error.name === "AbortError") return;
      if (error.message === "BLOCKED_DIRECTORY") {
        // Trigger the fallback file input
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
    const fileCount = src.type === "files" ? src.files.size : 0;
    showToast(
      `Diretório "${src.name}" aberto em modo leitura (${fileCount} arquivo(s) .md)`,
      "success",
      5000,
    );

    // Reset input so the same folder can be selected again
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
      }, 300);
    },
    [files]
  );

  /* ─── Toast ─── */
  const showToast = (message: string, type: "success" | "error", duration = 3000) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  };

  /* ─── Effects ─── */
  useEffect(() => {
    if (source) loadData(source);
  }, [source, loadData]);

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
          </span>
          <div className="toolbar-actions">
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
          ) : (
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
