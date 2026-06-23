import { useState, useEffect, useCallback, useRef } from 'react';
import { useSandboxStore } from '../stores/sandboxStore';

const MIN_WIDTH = 280;
const MAX_WIDTH = 1200;

export default function SandboxPanel() {
  const {
    currentResourceUrl,
    sandboxPreviewOpen,
    isPolling,
    minimizeSandbox,
    refreshSandbox,
    sandboxInfo,
  } = useSandboxStore();

  const [expanded, setExpanded] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'onDisConnected') {
        console.log('[SandboxPanel] received onDisConnected from iframe, refreshing sandbox info');
        void refreshSandbox();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshSandbox]);
  const [dragging, setDragging] = useState(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const startWidth = useRef(0);
  const [customWidth, setCustomWidth] = useState<number | null>(null);

  useEffect(() => {
    if (sandboxPreviewOpen) return;
    queueMicrotask(() => {
      setExpanded(false);
    });
  }, [sandboxPreviewOpen]);

  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setDragging(true);
    startX.current = e.clientX;
    startWidth.current = panelRef.current?.offsetWidth ?? 0;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setCustomWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  if (!sandboxPreviewOpen || !currentResourceUrl) {
    if (isPolling) {
      return (
        <div className="flex-[62] rounded-2xl border border-gray-200 flex flex-col items-center justify-center gap-3 bg-gray-50 overflow-hidden">
          <svg className="animate-spin w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-gray-500">正在等待沙箱就绪...</span>
        </div>
      );
    }
    return null;
  }

  if (expanded) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setExpanded(false)} />
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="h-10 flex items-center justify-between px-3 border-b border-gray-100 shrink-0">
            <span className="text-sm font-medium text-gray-700">沙箱预览</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleRefresh}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                title="刷新"
              >
                <RefreshIcon />
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                title="退出全屏"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe
              key={`${sandboxInfo?.sandboxSessionId ?? ''}-${currentResourceUrl}-${iframeKey}`}
              src={currentResourceUrl}
              className="w-full h-full border-0"
              title="沙箱预览"
              sandbox="allow-scripts allow-same-origin allow-popups"
              loading="lazy"
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`flex flex-row h-full rounded-2xl border border-gray-200 overflow-hidden ${!customWidth ? 'flex-[62]' : ''}`}
      style={customWidth ? { width: customWidth, flexShrink: 0 } : undefined}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      />
      {/* Panel content */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="h-10 flex items-center justify-between px-3 border-b border-gray-100 shrink-0">
          <span className="text-sm font-medium text-gray-700">沙箱预览</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              title="刷新"
            >
              <RefreshIcon />
            </button>
            <button
              onClick={() => setExpanded(true)}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              title="全屏"
            >
              <ExpandIcon />
            </button>
            <button
              onClick={minimizeSandbox}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              title="最小化"
            >
              <MinimizeIcon />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            key={`${sandboxInfo?.sandboxSessionId ?? ''}-${currentResourceUrl}-${iframeKey}`}
            src={currentResourceUrl}
            className="w-full h-full border-0"
            title="沙箱预览"
            sandbox="allow-scripts allow-same-origin allow-popups"
            loading="lazy"
            style={{ pointerEvents: dragging ? 'none' : 'auto' }}
          />
        </div>
      </div>
    </div>
  );
}

const FLOAT_W = 180;
const FLOAT_H = 120;

export function SandboxMiniFloat() {
  const { currentResourceUrl, sandboxMinimized, restoreSandbox } = useSandboxStore();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const prevMinimized = useRef(sandboxMinimized);

  useEffect(() => {
    if (sandboxMinimized && !prevMinimized.current) {
      setPos(null);
    }
    prevMinimized.current = sandboxMinimized;
  }, [sandboxMinimized]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!floatRef.current) return;
    e.preventDefault();
    const rect = floatRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    moved.current = false;

    const onMove = (ev: MouseEvent) => {
      moved.current = true;
      setPos({ x: ev.clientX - offsetX, y: ev.clientY - offsetY });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const handleClick = useCallback(() => {
    if (!moved.current) restoreSandbox();
  }, [restoreSandbox]);

  if (!sandboxMinimized || !currentResourceUrl) return null;

  const style: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, width: FLOAT_W, height: FLOAT_H }
    : { position: 'absolute', right: 8, bottom: 72, width: FLOAT_W, height: FLOAT_H };

  return (
    <div
      ref={floatRef}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      className="rounded-xl border border-gray-200 shadow-lg overflow-hidden bg-white hover:border-primary/60 hover:shadow-xl transition-shadow group cursor-grab active:cursor-grabbing z-30 select-none"
      style={style}
      title="拖动移动 · 点击展开"
    >
      <iframe
        src={currentResourceUrl}
        className="w-[600px] h-[450px] border-0 pointer-events-none origin-top-left"
        style={{ transform: 'scale(0.3)' }}
        title="沙箱缩略图"
        sandbox="allow-scripts allow-same-origin"
        tabIndex={-1}
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition flex items-center justify-center">
        <span className="opacity-0 group-hover:opacity-100 transition text-[11px] font-medium text-white bg-black/60 rounded px-2 py-0.5">
          点击展开
        </span>
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
