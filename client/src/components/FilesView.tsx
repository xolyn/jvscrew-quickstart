import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuthStore } from '../stores/authStore';
import { listTemplates } from '../services/api';
import {
  clearUserWorkspace,
  deleteWorkspaceFile,
  getWorkspaceFileDownloadUrl,
  getWorkspaceFileUploadUrl,
  listWorkspaceFiles,
  putFileToPresignedUrl,
  syncWorkspaceFiles,
} from '../services/files';
import type { TemplateItem } from '../types/api';
import type { WorkspaceFile } from '../types/files';

const PAGE_SIZE = 50;

const UPLOAD_ENABLED = true;

const AVATARS = [
  'https://img.alicdn.com/imgextra/i2/6000000006913/O1CN017tneP620wD8kVZFDn_!!6000000006913-2-gg_dtc.png',
  'https://img.alicdn.com/imgextra/i4/6000000005580/O1CN01AVtvcn1r5hBVIkwET_!!6000000005580-2-gg_dtc.png',
  'https://img.alicdn.com/imgextra/i4/6000000003494/O1CN01wRFHmI1bgIzVwQs2S_!!6000000003494-2-gg_dtc.png',
  'https://img.alicdn.com/imgextra/i4/6000000001106/O1CN01hnqFxM1K2bBd0IzJt_!!6000000001106-2-gg_dtc.png',
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}


function formatDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}


interface ColumnDef {
  key: string;
  label: string;
  initialWidth: number;
  minWidth: number;
  resizable: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: 'name', label: '文件名', initialWidth: 360, minWidth: 150, resizable: true },
  { key: 'source', label: '来自专家', initialWidth: 150, minWidth: 80, resizable: true },
  { key: 'size', label: '大小', initialWidth: 90, minWidth: 50, resizable: true },
  { key: 'modifiedAt', label: '最后修改时间', initialWidth: 180, minWidth: 100, resizable: true },
  { key: 'action', label: '操作', initialWidth: 110, minWidth: 96, resizable: false },
];

const COL_WIDTHS_STORAGE_KEY = 'files-view-col-widths-v2';

function useResizableColumns(columns: ColumnDef[]) {
  const [widths, setWidths] = useState(() => {
    try {
      const cached = sessionStorage.getItem(COL_WIDTHS_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as number[];
        if (parsed.length === columns.length) return parsed;
      }
    } catch { /* ignore */ }
    return columns.map((c) => c.initialWidth);
  });
  const dragging = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (widths.length !== columns.length) {
      setWidths(columns.map((c) => c.initialWidth));
    }
  }, [columns.length, widths.length, columns]);

  const persistWidths = useCallback((next: number[]) => {
    try { sessionStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const onMouseDown = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { colIndex, startX: e.clientX, startWidth: widths[colIndex] };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const { colIndex: idx, startX, startWidth } = dragging.current;
      const delta = ev.clientX - startX;
      const newWidth = Math.max(columns[idx].minWidth, startWidth + delta);
      setWidths((prev) => {
        const next = [...prev];
        next[idx] = newWidth;
        return next;
      });
    };

    const onMouseUp = () => {
      dragging.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidths((current) => { persistWidths(current); return current; });
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [widths, columns, persistWidths]);

  return { widths, onMouseDown };
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt', 'md', 'log', 'json', 'yaml', 'yml', 'xml', 'toml', 'csv',
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'kt', 'go', 'rs', 'rb',
  'html', 'htm', 'css', 'scss', 'sql', 'sh', 'bash', 'env', 'conf',
]);
const MAX_PREVIEW_SIZE = 50 * 1024;

type PreviewType = 'text' | 'pdf' | 'docx' | null;

function getPreviewType(file: WorkspaceFile): PreviewType {
  if (file.FileType !== 'file') return null;
  const ext = file.FileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (TEXT_PREVIEW_EXTENSIONS.has(ext) && file.Size <= MAX_PREVIEW_SIZE) return 'text';
  return null;
}

function isPreviewable(file: WorkspaceFile): boolean {
  return getPreviewType(file) !== null;
}

type FileIconStyle = { bg: string; text: string; label: string };

function getFileIconStyle(fileName: string): FileIconStyle {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return { bg: 'bg-red-50', text: 'text-red-500', label: 'PDF' };
    case 'doc': case 'docx':
      return { bg: 'bg-blue-50', text: 'text-blue-600', label: 'W' };
    case 'xls': case 'xlsx': case 'csv':
      return { bg: 'bg-green-50', text: 'text-green-600', label: 'X' };
    case 'ppt': case 'pptx':
      return { bg: 'bg-orange-50', text: 'text-orange-500', label: 'P' };
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'bmp':
      return { bg: 'bg-purple-50', text: 'text-purple-500', label: 'IMG' };
    case 'mp4': case 'avi': case 'mov': case 'mkv': case 'webm':
      return { bg: 'bg-pink-50', text: 'text-pink-500', label: 'VID' };
    case 'mp3': case 'wav': case 'flac': case 'aac': case 'ogg':
      return { bg: 'bg-indigo-50', text: 'text-indigo-500', label: 'AUD' };
    case 'zip': case 'rar': case '7z': case 'tar': case 'gz':
      return { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'ZIP' };
    case 'md': case 'txt': case 'log':
      return { bg: 'bg-gray-100', text: 'text-gray-600', label: 'TXT' };
    case 'json': case 'yaml': case 'yml': case 'xml': case 'toml':
      return { bg: 'bg-cyan-50', text: 'text-cyan-600', label: '{ }' };
    case 'js': case 'ts': case 'jsx': case 'tsx':
      return { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'JS' };
    case 'py':
      return { bg: 'bg-blue-50', text: 'text-blue-500', label: 'PY' };
    case 'java': case 'kt':
      return { bg: 'bg-orange-50', text: 'text-orange-600', label: 'JV' };
    case 'html': case 'htm': case 'css': case 'scss':
      return { bg: 'bg-orange-50', text: 'text-orange-500', label: '</>' };
    case 'sql':
      return { bg: 'bg-blue-50', text: 'text-blue-600', label: 'SQL' };
    default:
      return { bg: 'bg-[#F0F1F5]', text: 'text-[#8E8E93]', label: ext.toUpperCase().slice(0, 3) || 'FILE' };
  }
}

function FileIcon({ fileName }: { fileName: string }) {
  const style = getFileIconStyle(fileName);
  return (
    <div className={`w-8 h-8 rounded-lg ${style.bg} flex items-center justify-center shrink-0`}>
      <span className={`text-[9px] font-bold ${style.text} leading-none`}>{style.label}</span>
    </div>
  );
}

interface PreviewState {
  file: WorkspaceFile;
  type: PreviewType;
  content: string | null;
  url: string | null;
  arrayBuffer: ArrayBuffer | null;
  loading: boolean;
  error: string | null;
}

function DocxRenderer({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    (async () => {
      const { renderAsync } = await import('docx-preview');
      if (cancelled || !containerRef.current) return;
      containerRef.current.innerHTML = '';
      await renderAsync(arrayBuffer, containerRef.current, undefined, {
        className: 'docx-preview-wrapper',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: true,
      });
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer]);

  return <div ref={containerRef} className="w-full min-h-[300px]" />;
}

function FilePreviewModal({ state, externalUserId, templateId, onClose, onDownload, onSaved }: {
  state: PreviewState;
  externalUserId?: string;
  templateId?: string;
  onClose: () => void;
  onDownload: () => void;
  onSaved: (newContent: string) => void;
}) {
  const isMarkdown = useMemo(() => {
    const ext = state.file.FileName.split('.').pop()?.toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }, [state.file.FileName]);

  const [viewMode, setViewMode] = useState<'preview' | 'source' | 'edit'>('preview');
  const [draft, setDraft] = useState<string>(state.content ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const isRichPreview = state.type === 'pdf' || state.type === 'docx';
  const dirty = viewMode === 'edit' && draft !== (state.content ?? '');

  // 内容变化（重新打开预览时）刷新草稿
  useEffect(() => { setDraft(state.content ?? ''); }, [state.content, state.file.FilePath]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dirty && !window.confirm('有未保存的修改，确认放弃？')) return;
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, dirty]);

  const handleSave = async () => {
    if (!externalUserId || !templateId) {
      setSaveError('缺少用户或模板上下文');
      return;
    }
    setIsSaving(true);
    setSaveError('');
    try {
      // 同名覆盖：FilePath 去除前导 / 即得相对路径
      const filePath = state.file.FilePath.replace(/^\/+/, '');
      const urlResp = await getWorkspaceFileUploadUrl({
        externalUserId,
        filePath,
        templateId,
      });
      const blob = new Blob([draft], { type: 'text/markdown' });
      const fileToUpload = new File([blob], state.file.FileName, { type: 'text/markdown' });
      if (urlResp.MaxFileSize && fileToUpload.size > urlResp.MaxFileSize) {
        throw new Error(`文件超出上限 ${(urlResp.MaxFileSize / 1024 / 1024).toFixed(0)} MB`);
      }
      await putFileToPresignedUrl(urlResp.UploadUrl, fileToUpload, urlResp.UploadHeadersHint);
      onSaved(draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      // 保存后留在预览，方便确认改动
      setViewMode('preview');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const requestClose = () => {
    if (dirty && !window.confirm('有未保存的修改，确认放弃？')) return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden ${
        isRichPreview
          ? 'w-[960px] max-w-[95vw] h-[85vh]'
          : 'w-[820px] max-w-[92vw] h-[80vh]'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileIcon fileName={state.file.FileName} />
            <span className="text-sm font-medium text-black truncate">{state.file.FileName}</span>
            <span className="text-xs text-black/40 shrink-0">{formatBytes(state.file.Size)}</span>
            {dirty && (
              <span className="text-[11px] text-amber-600 shrink-0">· 未保存</span>
            )}
            {savedFlash && (
              <span className="text-[11px] text-emerald-600 shrink-0 inline-flex items-center gap-0.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                已保存
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isMarkdown && (
              <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition ${viewMode === 'preview' ? 'bg-white text-black shadow-sm' : 'text-black/50 hover:text-black/70'}`}
                >
                  预览
                </button>
                <button
                  onClick={() => setViewMode('source')}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition ${viewMode === 'source' ? 'bg-white text-black shadow-sm' : 'text-black/50 hover:text-black/70'}`}
                >
                  源码
                </button>
                <button
                  onClick={() => setViewMode('edit')}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition ${viewMode === 'edit' ? 'bg-white text-primary shadow-sm' : 'text-black/50 hover:text-black/70'}`}
                >
                  编辑
                </button>
              </div>
            )}
            {isMarkdown && viewMode === 'edit' && (
              <button
                onClick={handleSave}
                disabled={isSaving || !dirty}
                className="px-3 py-1 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
              >
                {isSaving && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {isSaving ? '保存中...' : '保存'}
              </button>
            )}
            <button
              onClick={onDownload}
              className="text-xs text-primary hover:text-primary/80 font-medium transition"
            >
              下载
            </button>
            <button
              onClick={requestClose}
              className="p-1 rounded hover:bg-gray-100 text-black/40 hover:text-black transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {saveError && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600 flex items-center justify-between shrink-0">
            <span className="break-all">{saveError}</span>
            <button onClick={() => setSaveError('')} className="ml-2 text-red-400 hover:text-red-600 shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className={`flex-1 min-h-0 ${state.type === 'pdf' ? '' : viewMode === 'edit' ? '' : 'overflow-auto p-5'}`}>
          {state.loading && (
            <div className="flex items-center justify-center h-32 text-sm text-text-hint">加载中...</div>
          )}
          {state.error && (
            <div className="flex items-center justify-center h-32 text-sm text-red-500">{state.error}</div>
          )}
          {!state.loading && !state.error && state.type === 'pdf' && state.url && (
            <iframe src={state.url} className="w-full h-full border-0" title="PDF Preview" />
          )}
          {!state.loading && !state.error && state.type === 'docx' && state.arrayBuffer && (
            <DocxRenderer arrayBuffer={state.arrayBuffer} />
          )}
          {!state.loading && !state.error && state.type === 'text' && state.content !== null && (
            isMarkdown && viewMode === 'edit' ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="w-full h-full px-5 py-4 text-[13px] leading-5 text-black/80 font-mono resize-none focus:outline-none border-0"
                placeholder="编辑 Markdown 内容..."
              />
            ) : isMarkdown && viewMode === 'preview' ? (
              <div className="prose prose-sm max-w-none text-black/80">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className="text-[13px] leading-5 text-black/80 font-mono whitespace-pre-wrap break-words m-0 p-0">
                {state.content}
              </pre>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function FilesView() {
  const config = useAuthStore((s) => s.config);

  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const { widths, onMouseDown } = useResizableColumns(COLUMNS);

  useEffect(() => {
    (async () => {
      try {
        const data = await listTemplates();
        setTemplates(data.Items);
        if (config?.templateId) {
          setSelectedTemplateId(config.templateId);
        } else if (data.Items.length > 0) {
          setSelectedTemplateId(data.Items[0].TemplateId);
        }
      } catch { /* ignore */ }
    })();
  }, [config?.templateId]);

  const loadFiles = useCallback(async (templateId: string, path: string, page: number) => {
    if (!config || !templateId) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listWorkspaceFiles({
        externalUserId: config.externalUserId,
        templateId,
        path,
        pageSize: PAGE_SIZE,
        pageNumber: page,
      });
      setFiles(data.Files);
      setTotalCount(data.TotalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [config]);

  useEffect(() => {
    if (config && selectedTemplateId) {
      void loadFiles(selectedTemplateId, currentPath, pageNumber);
    }
  }, [config, selectedTemplateId, currentPath, pageNumber, loadFiles]);

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setCurrentPath('/');
    setPageNumber(1);
    setFiles([]);
  };

  const handleSync = async () => {
    if (!config || !selectedTemplateId || isSyncing) return;
    setIsSyncing(true);
    try {
      await syncWorkspaceFiles({ externalUserId: config.externalUserId, templateId: selectedTemplateId });
    } catch { /* non-fatal */ }
    await loadFiles(selectedTemplateId, currentPath, pageNumber);
    setIsSyncing(false);
  };

  const [isClearing, setIsClearing] = useState(false);
  const [clearStatus, setClearStatus] = useState('');

  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [templateTooltip, setTemplateTooltip] = useState<{
    templateId: string;
    templateKey: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!pendingDeletePath) return;
    const t = setTimeout(() => setPendingDeletePath(null), 2500);
    return () => clearTimeout(t);
  }, [pendingDeletePath]);

  const handleDeleteFile = useCallback(async (file: WorkspaceFile) => {
    if (!config || !selectedTemplateId) return;
    const filePath = file.FilePath.replace(/^\/+/, '');
    setDeletingPath(file.FilePath);
    setPendingDeletePath(null);
    setError('');
    try {
      await deleteWorkspaceFile({
        externalUserId: config.externalUserId,
        filePath,
        templateId: selectedTemplateId,
      });
      setFiles((prev) => prev.filter((f) => f.FilePath !== file.FilePath));
      setTotalCount((c) => Math.max(0, c - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingPath(null);
    }
  }, [config, selectedTemplateId]);

  const handleUploadFiles = useCallback(async (fileList: FileList) => {
    if (!config || !selectedTemplateId) return;
    const items = Array.from(fileList);
    if (items.length === 0) return;

    const dir = currentPath.replace(/^\/+/, '').replace(/\/+$/, '');
    setIsUploading(true);
    setError('');
    setUploadStatus('');
    let okCount = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        const file = items[i];
        setUploadStatus(`上传中 (${i + 1}/${items.length}) ${file.name}`);
        const targetPath = dir ? `${dir}/${file.name}` : file.name;

        const urlResp = await getWorkspaceFileUploadUrl({
          externalUserId: config.externalUserId,
          filePath: targetPath,
          templateId: selectedTemplateId,
        });
        if (urlResp.MaxFileSize && file.size > urlResp.MaxFileSize) {
          throw new Error(`${file.name} 超过单文件上限 ${formatBytes(urlResp.MaxFileSize)}`);
        }
        await putFileToPresignedUrl(urlResp.UploadUrl, file, urlResp.UploadHeadersHint);
        okCount += 1;
      }
      setUploadStatus(`已上传 ${okCount} 个文件`);
      await loadFiles(selectedTemplateId, currentPath, pageNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadStatus((s) => (s.startsWith('已上传') ? '' : s)), 2500);
    }
  }, [config, selectedTemplateId, currentPath, pageNumber, loadFiles]);

  const handlePickUpload = () => {
    if (isUploading) return;
    uploadInputRef.current?.click();
  };

  const onUploadInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleUploadFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleClearWorkspace = async () => {
    if (!config || isClearing) return;
    const scope = selectedTemplate?.TemplateKey || selectedTemplateId || '当前模板';
    if (!window.confirm(
      `确定要重置「${scope}」的工作空间吗？\n该操作会清空云端为该模板存储的所有用户文件，且不可撤销。`,
    )) return;
    setIsClearing(true);
    setError('');
    setClearStatus('');
    try {
      const result = await clearUserWorkspace({
        externalUserId: config.externalUserId,
        templateId: selectedTemplateId || undefined,
      });
      const failedDetail = result.Workspaces
        .filter((w) => w.Status === 'failed')
        .map((w) => `${w.TemplateId}: ${w.Error || '未知错误'}`)
        .join('；');
      setClearStatus(
        result.FailedCount > 0
          ? `已清理 ${result.ClearedCount} 个，失败 ${result.FailedCount} 个 (${failedDetail})`
          : `已清理 ${result.ClearedCount} 个工作空间`,
      );
      if (selectedTemplateId) {
        await loadFiles(selectedTemplateId, '/', 1);
        setCurrentPath('/');
        setPageNumber(1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear workspace');
    } finally {
      setIsClearing(false);
    }
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setPageNumber(1);
  };

  const handleDownload = async (file: WorkspaceFile) => {
    try {
      const data = await getWorkspaceFileDownloadUrl({
        filePath: file.FilePath,
        externalUserId: config?.externalUserId,
        templateId: selectedTemplateId,
      });
      const url = data.DownloadUrl;
      if (!url || typeof url !== 'string') {
        throw new Error('No download URL returned from API');
      }
      window.open(url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handlePreview = async (file: WorkspaceFile) => {
    const previewType = getPreviewType(file);
    if (!previewType) return;
    setPreview({ file, type: previewType, content: null, url: null, arrayBuffer: null, loading: true, error: null });
    try {
      const data = await getWorkspaceFileDownloadUrl({
        filePath: file.FilePath,
        externalUserId: config?.externalUserId,
        templateId: selectedTemplateId,
      });
      const downloadUrl = data.DownloadUrl;
      if (!downloadUrl) throw new Error('No download URL');

      if (previewType === 'pdf') {
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        const pdfUrl = `${blobUrl}#filename=${encodeURIComponent(file.FileName)}`;
        setPreview({ file, type: previewType, content: null, url: pdfUrl, arrayBuffer: null, loading: false, error: null });
      } else if (previewType === 'docx') {
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
        const buf = await res.arrayBuffer();
        setPreview({ file, type: previewType, content: null, url: null, arrayBuffer: buf, loading: false, error: null });
      } else {
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
        const text = await res.text();
        setPreview({ file, type: previewType, content: text, url: null, arrayBuffer: null, loading: false, error: null });
      }
    } catch (err) {
      setPreview((prev) => prev ? { ...prev, loading: false, error: err instanceof Error ? err.message : 'Preview failed' } : null);
    }
  };

  const selectedTemplate = templates.find((t) => t.TemplateId === selectedTemplateId);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const renderResizeHandle = (colIndex: number) => {
    if (!COLUMNS[colIndex].resizable) return null;
    return (
      <div
        className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10 group/handle flex items-center justify-center"
        onMouseDown={(e) => onMouseDown(colIndex, e)}
      >
        <div className="w-px h-4 bg-transparent group-hover/handle:bg-[#D5D8E6] transition" />
      </div>
    );
  };

  return (
    <div className="h-full w-full overflow-hidden flex flex-col">
      <div className="flex flex-col gap-4 p-4 h-full min-h-0">

        {/* Top row: template pills + storage stats */}
        <div className="flex items-center justify-between gap-4 shrink-0">
          {/* Template pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 min-w-0">
            {templates.map((t, idx) => {
              const active = t.TemplateId === selectedTemplateId;
              return (
                <button
                  key={t.TemplateId}
                  onClick={() => handleSelectTemplate(t.TemplateId)}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTemplateTooltip({
                      templateId: t.TemplateId,
                      templateKey: t.TemplateKey || '',
                      x: rect.left + rect.width / 2,
                      y: rect.bottom + 6,
                    });
                  }}
                  onMouseLeave={() => setTemplateTooltip(null)}
                  style={{ borderRadius: '232px' }}
                  className={`flex items-center gap-2 px-3 w-[180px] h-[55px] bg-white transition shrink-0 overflow-hidden ${
                    active
                      ? 'border-2 border-primary'
                      : 'border border-[#D5D8E6] hover:border-gray-400'
                  }`}
                >
                  <img
                    src={AVATARS[idx % AVATARS.length]}
                    alt={t.TemplateKey || t.TemplateId}
                    className="w-9 h-9 rounded-full shrink-0"
                  />
                  <div className={`text-sm font-medium leading-5 truncate text-left min-w-0 ${active ? 'text-black' : 'text-black/40'}`}>
                    {t.TemplateKey || t.TemplateId}
                  </div>
                </button>
              );
            })}

          </div>

        </div>

        {clearStatus && (
          <div className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs flex items-center justify-between shrink-0">
            <span>{clearStatus}</span>
            <button onClick={() => setClearStatus('')} className="text-emerald-600 hover:text-emerald-800">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Breadcrumb (only when not at root) */}
        {currentPath !== '/' && (
          <div className="flex items-center gap-1.5 text-sm text-text-secondary shrink-0">
            <button onClick={() => handleNavigate('/')} className="hover:text-primary transition">
              {selectedTemplate?.TemplateKey || '根目录'}
            </button>
            {currentPath.split('/').filter(Boolean).map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-1.5">
                <svg className="w-3 h-3 text-text-hint" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 5 7 7-7 7" />
                </svg>
                <button
                  onClick={() => handleNavigate('/' + arr.slice(0, i + 1).join('/'))}
                  className={`hover:text-primary transition ${i === arr.length - 1 ? 'text-text font-medium' : ''}`}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm flex items-center justify-between shrink-0">
            <span>{error}</span>
            <button
              onClick={() => { setError(''); void loadFiles(selectedTemplateId, currentPath, pageNumber); }}
              className="text-xs text-red-500 hover:text-red-700 font-medium"
            >
              重试
            </button>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Table header */}
          <div className="flex items-center h-10 shrink-0 text-[14px] font-medium text-[#000000CC] leading-[22px] select-none">
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onUploadInputChange}
            />
            {COLUMNS.map((col, i) => (
              <div
                key={col.key}
                className="relative flex items-center h-full px-1 shrink-0"
                style={{ width: widths[i], minWidth: col.minWidth }}
              >
                <span className="truncate">{i === 0 ? `文件 ${totalCount}` : col.label}</span>
                {renderResizeHandle(i)}
              </div>
            ))}
            <div className="ml-auto flex items-center gap-1.5 shrink-0 pr-1">
              {UPLOAD_ENABLED && (
                <button
                  onClick={handlePickUpload}
                  disabled={isUploading || !selectedTemplateId}
                  className="h-8 px-2.5 rounded-lg border border-primary/30 bg-white text-primary text-[11px] font-medium
                             hover:bg-primary/5 hover:border-primary/50 transition disabled:opacity-50 disabled:cursor-not-allowed
                             flex items-center gap-1"
                  title={selectedTemplate?.TemplateKey
                    ? `上传到「${selectedTemplate.TemplateKey}」 · ${currentPath}`
                    : '上传文件到当前目录'}
                >
                  {isUploading ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 7.5L12 3m0 0L7.5 7.5M12 3v13.5" />
                    </svg>
                  )}
                  {isUploading ? '上传中' : '上传'}
                </button>
              )}
              <button
                onClick={handleClearWorkspace}
                disabled={isClearing || !config}
                className="h-8 px-2.5 rounded-lg border border-red-200 bg-white text-red-600 text-[11px] font-medium
                           hover:bg-red-50 hover:border-red-300 transition disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center gap-1"
                title={selectedTemplate?.TemplateKey
                  ? `清空「${selectedTemplate.TemplateKey}」的工作空间`
                  : '清空当前模板的工作空间'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                </svg>
                {isClearing ? '重置中' : '重置'}
              </button>
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="w-8 h-8 rounded-lg border border-[#D5D8E6] bg-white flex items-center justify-center shrink-0
                  hover:border-gray-400 transition disabled:opacity-50"
                title={isSyncing ? '同步中...' : '刷新同步'}
              >
                <svg className={`w-4 h-4 text-[#00000066] ${isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {uploadStatus && !error && (
            <div className="px-2 py-1 text-[11px] text-primary/80 shrink-0">{uploadStatus}</div>
          )}

          {/* Table body */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center h-40 text-sm text-text-hint">加载中...</div>
            )}
            {!isLoading && files.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-sm text-text-hint">
                <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
                </svg>
                <span>暂无文件</span>
              </div>
            )}
            {!isLoading && files.map((file) => (
              <div
                key={file.FilePath}
                className="flex items-center h-[60px] hover:bg-gray-50/50 transition text-[14px] text-[#000000CC] leading-[22px]"
              >
                {/* Col: 文件名 */}
                <div
                  className={`flex items-center gap-2 h-full px-1 min-w-0 shrink-0 ${
                    file.FileType === 'directory' || isPreviewable(file) ? 'cursor-pointer' : ''
                  }`}
                  style={{ width: widths[0], minWidth: COLUMNS[0].minWidth }}
                  onClick={() => {
                    if (file.FileType === 'directory') {
                      handleNavigate(file.FilePath.startsWith('/') ? file.FilePath : `/${file.FilePath}`);
                    } else if (isPreviewable(file)) {
                      void handlePreview(file);
                    }
                  }}
                >
                  {file.FileType === 'directory' ? (
                    <div className="w-8 h-8 shrink-0">
                      <svg className="w-8 h-8 text-[#F5A623]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                      </svg>
                    </div>
                  ) : (
                    <FileIcon fileName={file.FileName} />
                  )}
                  <span className="truncate">{file.FileName}</span>
                </div>

                {/* Col: 来自专家 */}
                <div
                  className="flex items-center h-full px-1 truncate shrink-0"
                  style={{ width: widths[1], minWidth: COLUMNS[1].minWidth }}
                >
                  {selectedTemplate?.TemplateKey || '-'}
                </div>

                {/* Col: 大小 */}
                <div
                  className="flex items-center h-full px-1 shrink-0"
                  style={{ width: widths[2], minWidth: COLUMNS[2].minWidth }}
                >
                  {file.FileType === 'file' ? formatBytes(file.Size) : '-'}
                </div>

                {/* Col: 最后修改时间 */}
                <div
                  className="flex items-center h-full px-1 whitespace-nowrap shrink-0"
                  style={{ width: widths[3], minWidth: COLUMNS[3].minWidth }}
                >
                  {file.ModifiedAt ? formatDate(file.ModifiedAt) : '-'}
                </div>

                {/* Col: 操作 */}
                <div
                  className="flex items-center justify-center gap-0.5 h-full shrink-0"
                  style={{ width: widths[4], minWidth: COLUMNS[4].minWidth }}
                >
                  {file.FileType === 'file' && (
                    pendingDeletePath === file.FilePath ? (
                      <>
                        <button
                          onClick={() => void handleDeleteFile(file)}
                          disabled={deletingPath === file.FilePath}
                          className="px-2 h-7 rounded-md bg-red-500 text-white text-[11px] font-medium hover:bg-red-600 disabled:opacity-50 transition"
                        >
                          {deletingPath === file.FilePath ? '删除中' : '确认删除'}
                        </button>
                        <button
                          onClick={() => setPendingDeletePath(null)}
                          className="px-1.5 h-7 rounded-md text-[11px] text-black/50 hover:bg-gray-100 transition"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleDownload(file)}
                          className="p-1 rounded hover:bg-gray-100 text-text-muted hover:text-text transition"
                          title="下载"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setPendingDeletePath(file.FilePath)}
                          disabled={deletingPath === file.FilePath}
                          className="p-1 rounded hover:bg-red-50 text-text-muted hover:text-red-600 disabled:opacity-50 transition"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                          </svg>
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-end gap-3 text-xs text-text-secondary shrink-0">
          <span>共 {totalCount} 个文件</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                disabled={pageNumber <= 1}
                className="w-7 h-7 rounded border border-border bg-white flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m15 19-7-7 7-7" />
                </svg>
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPageNumber(p)}
                  className={`w-7 h-7 rounded border flex items-center justify-center transition ${
                    p === pageNumber
                      ? 'border-primary text-primary font-medium'
                      : 'border-border bg-white hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPageNumber((p) => Math.min(totalPages, p + 1))}
                disabled={pageNumber >= totalPages}
                className="w-7 h-7 rounded border border-border bg-white flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 5 7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>

      </div>

      {preview && (
        <FilePreviewModal
          state={preview}
          externalUserId={config?.externalUserId}
          templateId={selectedTemplateId}
          onClose={() => {
            if (preview.type === 'pdf' && preview.url) URL.revokeObjectURL(preview.url.split('#')[0]);
            setPreview(null);
          }}
          onDownload={() => { void handleDownload(preview.file); }}
          onSaved={(newContent) => {
            // 保存成功后：原地更新预览内容、字节大小，并刷新列表（更新 ModifiedAt 等）
            setPreview((prev) => prev ? {
              ...prev,
              content: newContent,
              file: { ...prev.file, Size: new Blob([newContent]).size },
            } : prev);
            setFiles((prevFiles) => prevFiles.map((f) =>
              f.FilePath === preview.file.FilePath
                ? { ...f, Size: new Blob([newContent]).size, ModifiedAt: new Date().toISOString() }
                : f,
            ));
            // 后台同步真实元数据（异步即可，不阻塞 UI）
            if (selectedTemplateId) {
              void loadFiles(selectedTemplateId, currentPath, pageNumber);
            }
          }}
        />
      )}

      {templateTooltip && (
        <div
          className="fixed z-[100] -translate-x-1/2 px-2.5 py-1.5 rounded-md bg-gray-900/95 text-white text-[11px] shadow-lg pointer-events-none whitespace-nowrap"
          style={{ left: templateTooltip.x, top: templateTooltip.y }}
        >
          <div className="font-mono leading-tight">{templateTooltip.templateId}</div>
          {templateTooltip.templateKey && (
            <div className="text-white/55 mt-0.5 leading-tight">{templateTooltip.templateKey}</div>
          )}
        </div>
      )}
    </div>
  );
}
