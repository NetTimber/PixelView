import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  Download,
  Expand,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Monitor,
  Moon,
  Info,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  RotateCw,
  RefreshCw,
  Scan,
  Sun,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./App.css";

type ThemeMode = "system" | "light" | "dark";

interface ImageEntry {
  id: string;
  name: string;
  path: string;
  size: number;
  modified: number;
}

interface FolderSnapshot {
  directory: string;
  currentIndex: number;
  items: ImageEntry[];
}

interface NaturalSize {
  width: number;
  height: number;
}

interface UpdateInfo {
  currentVersion: string;
  version: string;
  body?: string;
  date?: string;
}

interface UpdateProgress {
  downloaded: number;
  total?: number;
}

const appWindow = getCurrentWindow();
const defaultUpdateEndpoint = "https://github.com/NetTimber/PixelView/releases/latest/download/latest.json";
const zoomLevels = [0.0625, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32];

function imageUrl(id: string, kind: "image" | "thumbnail" = "image") {
  return `http://pixelview.localhost/${kind}/${id}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ToolButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button${active ? " is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function App() {
  const [items, setItems] = useState<ImageEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [directory, setDirectory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState<ThemeMode>(() =>
    (localStorage.getItem("pixelview.theme") as ThemeMode | null) ?? "system",
  );
  const [sidebarVisible, setSidebarVisible] = useState(
    () => localStorage.getItem("pixelview.sidebar") !== "hidden",
  );
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState<NaturalSize>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [updateCenterOpen, setUpdateCenterOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("0.2.1");
  const [updateEndpoint, setUpdateEndpoint] = useState(
    () => localStorage.getItem("pixelview.updateEndpoint") || defaultUpdateEndpoint,
  );
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateMessage, setUpdateMessage] = useState("尚未检查更新");
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);

  const viewerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef({ pointerId: -1, x: 0, y: 0 });
  const wheelGate = useRef(0);
  const toastTimer = useRef<number | undefined>(undefined);

  const current = currentIndex >= 0 ? items[currentIndex] : undefined;

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }, []);

  const resetView = useCallback(() => {
    setFitMode(true);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, []);

  const loadPath = useCallback(
    async (path: string) => {
      setLoading(true);
      setError("");
      try {
        const snapshot = await invoke<FolderSnapshot>("open_image", { path });
        setItems(snapshot.items);
        setCurrentIndex(snapshot.currentIndex);
        setDirectory(snapshot.directory);
        resetView();
      } catch (reason) {
        setError(String(reason));
      } finally {
        setLoading(false);
      }
    },
    [resetView],
  );

  const chooseFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"],
        },
      ],
    });
    if (selected) await loadPath(selected);
  }, [loadPath]);

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= items.length || index === currentIndex) return;
      setCurrentIndex(index);
      setNaturalSize({ width: 0, height: 0 });
      resetView();
    },
    [currentIndex, items.length, resetView],
  );

  const navigate = useCallback(
    (direction: -1 | 1) => selectIndex(currentIndex + direction),
    [currentIndex, selectIndex],
  );

  const fitImage = useCallback(
    (size = naturalSize) => {
      const container = viewerRef.current;
      if (!container || !size.width || !size.height) return;
      const rotated = Math.abs(rotation % 180) === 90;
      const width = rotated ? size.height : size.width;
      const height = rotated ? size.width : size.height;
      const ratio = Math.min(
        Math.max(0.05, (container.clientWidth - 64) / width),
        Math.max(0.05, (container.clientHeight - 64) / height),
      );
      const smartRatio = ratio >= 1 ? Math.max(1, Math.floor(ratio)) : ratio;
      setZoom(Math.min(32, smartRatio));
      setPan({ x: 0, y: 0 });
      setFitMode(true);
    },
    [naturalSize, rotation],
  );

  const setActualSize = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFitMode(false);
  }, []);

  const changeZoom = useCallback(
    (direction: -1 | 1) => {
      const next =
        direction > 0
          ? zoomLevels.find((level) => level > zoom + 0.0001) ?? zoomLevels[zoomLevels.length - 1]
          : [...zoomLevels].reverse().find((level) => level < zoom - 0.0001) ?? zoomLevels[0];
      setZoom(next);
      setFitMode(false);
    },
    [zoom],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!current) return;
      if (event.ctrlKey) {
        changeZoom(event.deltaY < 0 ? 1 : -1);
        return;
      }
      const now = performance.now();
      if (now - wheelGate.current < 120 || Math.abs(event.deltaY) < 4) return;
      wheelGate.current = now;
      navigate(event.deltaY > 0 ? 1 : -1);
    },
    [changeZoom, current, navigate],
  );

  const rotate = useCallback((delta: number) => {
    setRotation((value) => (value + delta + 360) % 360);
  }, []);

  const copyPath = useCallback(async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.path);
      showToast("已复制文件路径");
    } catch {
      showToast("无法访问剪贴板");
    }
  }, [current, showToast]);

  const copyImage = useCallback(async () => {
    const image = imageRef.current;
    if (!image || !current) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject()), "image/png"),
      );
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast(current.name.toLowerCase().endsWith(".gif") ? "已复制 GIF 当前帧" : "已复制图片");
    } catch {
      showToast("无法复制图片");
    }
  }, [current, showToast]);

  const revealCurrent = useCallback(async () => {
    if (!current) return;
    try {
      await revealItemInDir(current.path);
    } catch {
      showToast("无法在资源管理器中定位");
    }
  }, [current, showToast]);

  const toggleFullscreen = useCallback(async () => {
    await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
  }, []);

  const checkUpdate = useCallback(async (silent = false) => {
    const endpoint = updateEndpoint.trim();
    if (!endpoint) {
      if (!silent) setUpdateMessage("请先填写 HTTPS 更新清单地址");
      return;
    }
    setCheckingUpdate(true);
    setUpdateInfo(null);
    if (!silent) setUpdateMessage("正在连接更新服务器...");
    try {
      const available = await invoke<UpdateInfo | null>("check_for_update", { endpoint });
      setUpdateInfo(available);
      setUpdateMessage(available ? `发现新版本 v${available.version}` : "当前已经是最新版本");
    } catch (reason) {
      setUpdateMessage(`检查失败：${String(reason)}`);
    } finally {
      setCheckingUpdate(false);
    }
  }, [updateEndpoint]);

  const installOnlineUpdate = useCallback(async () => {
    if (!updateInfo) return;
    const approved = await confirm(
      `将下载并安装 PixelView v${updateInfo.version}。安装时应用会自动关闭，是否继续？`,
      { title: "安装更新", kind: "info" },
    );
    if (!approved) return;
    setInstallingUpdate(true);
    setUpdateProgress({ downloaded: 0 });
    setUpdateMessage("正在下载签名更新包...");
    try {
      await invoke("install_online_update", { endpoint: updateEndpoint.trim() });
    } catch (reason) {
      setInstallingUpdate(false);
      setUpdateMessage(`安装失败：${String(reason)}`);
    }
  }, [updateEndpoint, updateInfo]);

  const chooseLocalUpdate = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PixelView 安装包", extensions: ["exe"] }],
    });
    if (!selected) return;
    const approved = await confirm(
      "应用将关闭并由所选安装包覆盖升级。只应使用可信来源的 PixelView 安装包。",
      { title: "本地升级", kind: "warning" },
    );
    if (!approved) return;
    try {
      await invoke("install_local_update", { path: selected });
    } catch (reason) {
      setUpdateMessage(`无法升级：${String(reason)}`);
    }
  }, []);

  const uninstall = useCallback(async () => {
    const approved = await confirm(
      "将关闭 PixelView 并启动卸载程序。图片文件不会被删除，是否继续？",
      { title: "卸载 PixelView", kind: "warning" },
    );
    if (!approved) return;
    try {
      await invoke("uninstall_app");
    } catch (reason) {
      setUpdateMessage(`无法卸载：${String(reason)}`);
    }
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme((value) => (value === "system" ? "light" : value === "light" ? "dark" : "system"));
  }, []);

  useEffect(() => {
    localStorage.setItem("pixelview.theme", theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    void getVersion().then(setAppVersion);
    const unlistenProgress = listen<UpdateProgress>("update-progress", (event) => {
      setUpdateProgress(event.payload);
      setUpdateMessage("正在下载签名更新包...");
    });
    const unlistenDownloaded = listen("update-downloaded", () => {
      setUpdateMessage("下载完成，正在替换旧版本...");
    });
    return () => {
      void unlistenProgress.then((unlisten) => unlisten());
      void unlistenDownloaded.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (updateEndpoint) void checkUpdate(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("pixelview.sidebar", sidebarVisible ? "visible" : "hidden");
  }, [sidebarVisible]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void listen<string>("open-file", (event) => void loadPath(event.payload)).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    });
    void invoke<string | null>("startup_path").then((path) => {
      if (!disposed && path) void loadPath(path);
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [loadPath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void chooseFile();
      } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyPath();
      } else if (event.ctrlKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyImage();
      } else if (["ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        navigate(-1);
      } else if (["ArrowDown", "PageDown"].includes(event.key)) {
        event.preventDefault();
        navigate(1);
      } else if (["+", "="].includes(event.key)) {
        changeZoom(1);
      } else if (event.key === "-") {
        changeZoom(-1);
      } else if (event.key === "0") {
        fitImage();
      } else if (event.key === "1") {
        setActualSize();
      } else if (event.key.toLowerCase() === "r") {
        rotate(event.shiftKey ? -90 : 90);
      } else if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeZoom, chooseFile, copyImage, copyPath, fitImage, navigate, rotate, setActualSize, toggleFullscreen]);

  useLayoutEffect(() => {
    const container = viewerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (fitMode) fitImage();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitImage, fitMode]);

  const transform = useMemo(
    () => `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${zoom})`,
    [pan, rotation, zoom],
  );

  const themeIcon = theme === "system" ? <Monitor size={17} /> : theme === "light" ? <Sun size={17} /> : <Moon size={17} />;
  const themeLabel = theme === "system" ? "主题：跟随系统" : theme === "light" ? "主题：浅色" : "主题：深色";

  return (
    <main className="app-shell">
      <header className="titlebar" data-tauri-drag-region onDoubleClick={() => void appWindow.toggleMaximize()}>
        <div className="brand" data-tauri-drag-region>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>PixelView</span>
        </div>
        <div className="window-title" data-tauri-drag-region title={current?.path}>
          {current?.name ?? "像素图片查看器"}
        </div>
        <div className="window-controls">
          <ToolButton label="最小化" onClick={() => void appWindow.minimize()}><Minus size={16} /></ToolButton>
          <ToolButton label="最大化" onClick={() => void appWindow.toggleMaximize()}><Maximize2 size={14} /></ToolButton>
          <button className="window-close" type="button" title="关闭" aria-label="关闭" onClick={() => void invoke("exit_app")}><X size={17} /></button>
        </div>
      </header>

      <section className="toolbar" aria-label="查看工具">
        <div className="toolbar-group">
          <ToolButton label="打开图片 (Ctrl+O)" onClick={() => void chooseFile()}><FolderOpen size={18} /></ToolButton>
          <span className="toolbar-separator" />
          <ToolButton label="上一张 (↑)" onClick={() => navigate(-1)} disabled={currentIndex <= 0}><ChevronUp size={18} /></ToolButton>
          <ToolButton label="下一张 (↓)" onClick={() => navigate(1)} disabled={currentIndex < 0 || currentIndex >= items.length - 1}><ChevronDown size={18} /></ToolButton>
        </div>
        <div className="toolbar-group toolbar-center">
          <ToolButton label="缩小 (-)" onClick={() => changeZoom(-1)} disabled={!current}><ZoomOut size={18} /></ToolButton>
          <button className="zoom-readout" type="button" onClick={setActualSize} disabled={!current} title="原始尺寸 (1)">{Math.round(zoom * 100)}%</button>
          <ToolButton label="放大 (+)" onClick={() => changeZoom(1)} disabled={!current}><ZoomIn size={18} /></ToolButton>
          <ToolButton label="智能适应 (0)" onClick={() => fitImage()} disabled={!current} active={fitMode}><Scan size={18} /></ToolButton>
          <span className="toolbar-separator" />
          <ToolButton label="向左旋转 (Shift+R)" onClick={() => rotate(-90)} disabled={!current}><RotateCcw size={18} /></ToolButton>
          <ToolButton label="向右旋转 (R)" onClick={() => rotate(90)} disabled={!current}><RotateCw size={18} /></ToolButton>
          <ToolButton label="全屏 (F11)" onClick={() => void toggleFullscreen()}><Expand size={18} /></ToolButton>
        </div>
        <div className="toolbar-group toolbar-end">
          <ToolButton label="复制图片 (Ctrl+C)" onClick={() => void copyImage()} disabled={!current}><Copy size={17} /></ToolButton>
          <ToolButton label="复制路径 (Ctrl+Shift+C)" onClick={() => void copyPath()} disabled={!current}><Clipboard size={17} /></ToolButton>
          <ToolButton label="在资源管理器中定位" onClick={() => void revealCurrent()} disabled={!current}><FolderOpen size={17} /></ToolButton>
          <span className="toolbar-separator" />
          <ToolButton label={themeLabel} onClick={cycleTheme}>{themeIcon}</ToolButton>
          <ToolButton label={`关于与更新 (v${appVersion})`} onClick={() => setUpdateCenterOpen(true)}><Info size={17} /></ToolButton>
          <ToolButton label={sidebarVisible ? "隐藏图片列表" : "显示图片列表"} onClick={() => setSidebarVisible((value) => !value)}>
            {sidebarVisible ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </ToolButton>
        </div>
      </section>

      <div className={`workspace${sidebarVisible ? " has-sidebar" : ""}`}>
        <section
          ref={viewerRef}
          className={`viewer${dragging ? " is-dragging" : ""}`}
          onWheel={handleWheel}
          onPointerDown={(event) => {
            if (!current || event.button !== 0) return;
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (!dragging || dragRef.current.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - dragRef.current.x;
            const deltaY = event.clientY - dragRef.current.y;
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            setPan((value) => ({ x: value.x + deltaX, y: value.y + deltaY }));
            setFitMode(false);
          }}
          onPointerUp={(event) => {
            if (dragRef.current.pointerId === event.pointerId) setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
        >
          {current ? (
            <img
              ref={imageRef}
              className="main-image"
              src={imageUrl(current.id)}
              alt={current.name}
              crossOrigin="anonymous"
              draggable={false}
              style={{ transform }}
              onLoad={(event) => {
                const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
                setNaturalSize(size);
                if (fitMode) fitImage(size);
              }}
              onError={() => setError("图片无法解码或文件已经移动")}
            />
          ) : (
            <div className="empty-state">
              <span className="empty-icon"><ImageIcon size={34} strokeWidth={1.6} /></span>
              <h1>打开一张图片</h1>
              <p>PNG、JPG、WebP、BMP 或 GIF</p>
              <button type="button" className="primary-button" onClick={() => void chooseFile()}><FolderOpen size={17} />打开图片</button>
            </div>
          )}
          {loading && <div className="loading-indicator">正在读取文件夹...</div>}
          {error && <button type="button" className="error-banner" onClick={() => setError("")}>{error}<X size={15} /></button>}
          {toast && <div className="toast">{toast}</div>}
        </section>

        {sidebarVisible && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <div><strong>当前文件夹</strong><span title={directory}>{directory || "尚未打开"}</span></div>
              <span className="item-count">{items.length}</span>
            </div>
            <div className="image-list" role="listbox" aria-label="当前文件夹内的图片">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === currentIndex}
                  className={`image-list-item${index === currentIndex ? " is-current" : ""}`}
                  onClick={() => selectIndex(index)}
                  ref={(node) => {
                    if (node && index === currentIndex) node.scrollIntoView({ block: "nearest" });
                  }}
                >
                  <span className="thumbnail-wrap">
                    <img src={imageUrl(item.id, "thumbnail")} alt="" loading="lazy" draggable={false} />
                  </span>
                  <span className="file-meta"><strong title={item.name}>{item.name}</strong><small>{formatBytes(item.size)}</small></span>
                </button>
              ))}
              {!items.length && <div className="sidebar-empty"><Eye size={21} /><span>图片列表为空</span></div>}
            </div>
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <span>{naturalSize.width ? `${naturalSize.width} × ${naturalSize.height} px` : "—"}</span>
        <span>{current ? formatBytes(current.size) : "—"}</span>
        <span>{current ? `${currentIndex + 1} / ${items.length}` : "0 / 0"}</span>
        <span className="status-spacer" />
        <span>滚轮切图</span>
        <span>Ctrl + 滚轮缩放</span>
        <button type="button" className="version-link" onClick={() => setUpdateCenterOpen(true)}>v{appVersion}</button>
      </footer>

      {updateCenterOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !installingUpdate) setUpdateCenterOpen(false);
        }}>
          <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
            <header className="dialog-header">
              <div>
                <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
                <div><h2 id="update-title">PixelView</h2><span>版本 {appVersion}</span></div>
              </div>
              <button type="button" className="dialog-close" aria-label="关闭" title="关闭" disabled={installingUpdate} onClick={() => setUpdateCenterOpen(false)}><X size={17} /></button>
            </header>

            <div className="update-content">
              <label className="update-source">
                <span>更新清单地址</span>
                <input
                  type="url"
                  value={updateEndpoint}
                  disabled={checkingUpdate || installingUpdate}
                  placeholder="https://example.com/pixelview/latest.json"
                  onChange={(event) => {
                    const value = event.target.value;
                    setUpdateEndpoint(value);
                    localStorage.setItem("pixelview.updateEndpoint", value);
                    setUpdateInfo(null);
                    setUpdateMessage("更新源已修改，请重新检查");
                  }}
                />
              </label>

              <div className={`update-status${updateInfo ? " has-update" : ""}`}>
                <div><strong>{updateMessage}</strong>{updateInfo?.date && <span>发布时间：{new Date(updateInfo.date).toLocaleString()}</span>}</div>
                <button className="secondary-button" type="button" disabled={checkingUpdate || installingUpdate} onClick={() => void checkUpdate()}><RefreshCw size={16} className={checkingUpdate ? "is-spinning" : ""} />检查更新</button>
              </div>

              {updateInfo?.body && <p className="release-notes">{updateInfo.body}</p>}
              {updateProgress && (
                <div className="update-progress" aria-label="下载进度">
                  <span style={{ width: `${updateProgress.total ? Math.min(100, updateProgress.downloaded / updateProgress.total * 100) : 12}%` }} />
                </div>
              )}

              <div className="update-actions">
                {updateInfo && <button className="primary-button" type="button" disabled={installingUpdate} onClick={() => void installOnlineUpdate()}><Download size={17} />{installingUpdate ? "正在安装" : `安装 v${updateInfo.version}`}</button>}
                <button className="secondary-button" type="button" disabled={installingUpdate} onClick={() => void chooseLocalUpdate()}><Upload size={16} />选择本地安装包</button>
                <button className="danger-button" type="button" disabled={installingUpdate} onClick={() => void uninstall()}><Trash2 size={16} />卸载</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
