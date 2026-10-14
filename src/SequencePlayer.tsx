import { useEffect, useMemo, useState } from "react";
import { Pause, Play, SkipBack, ChevronLeft, ChevronRight, X, Film } from "lucide-react";
import { advanceFrame, sequenceLayout, type SequenceSettings, type RangeMode } from "./sequence";

export function useSequence(width: number, height: number, enabled: boolean) {
  const [settings, setSettings] = useState<SequenceSettings>({ rows: "1", columns: "1", mode: "all", row: "1", start: "1", end: "1" });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [interval, setInterval] = useState("100");
  const [loop, setLoop] = useState(true);
  const layout = useMemo(() => sequenceLayout(width, height, settings), [width, height, settings]);
  const milliseconds = Number(interval);
  const intervalValid = Number.isInteger(milliseconds) && milliseconds >= 16 && milliseconds <= 2000;
  const valid = !layout.error && intervalValid;
  const displayedFrame = layout.error ? 0 : Math.max(layout.start!, Math.min(layout.end!, frame));

  useEffect(() => {
    setPlaying(false);
    setFrame(layout.error ? 0 : layout.start!);
  }, [layout, enabled]);

  useEffect(() => {
    if (!enabled || !playing || !valid) return;
    let id = 0, last: number | undefined;
    let currentFrame = displayedFrame;
    const resetClock = () => { last = undefined; };
    const tick = (now: number) => {
      if (document.hidden) last = undefined;
      else if (last === undefined) last = now;
      else {
        const steps = Math.floor((now - last) / milliseconds);
        if (steps > 0) {
          last += steps * milliseconds;
          currentFrame = advanceFrame(currentFrame, steps, layout.start!, layout.end!, loop);
          setFrame(currentFrame);
          if (!loop && currentFrame === layout.end) { setPlaying(false); return; }
        }
      }
      id = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", resetClock);
    id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); document.removeEventListener("visibilitychange", resetClock); };
    // Frame updates do not restart the clock; timing changes intentionally do.
  }, [enabled, playing, valid, milliseconds, loop, layout]);

  const seek = (next: number) => { setPlaying(false); if (!layout.error) setFrame(Math.max(layout.start!, Math.min(layout.end!, next))); };
  const toggle = () => {
    if (!valid) return;
    if (!playing && displayedFrame === layout.end) setFrame(layout.start!);
    setPlaying(value => !value);
  };
  return { settings, setSettings, layout, frame: displayedFrame, playing: playing && valid, interval, setInterval, intervalValid, loop, setLoop, valid, seek, toggle };
}

type Player = ReturnType<typeof useSequence>;
export function SequencePlayer({ player: p, onClose }: { player: Player; onClose: () => void }) {
  const field = (label: string, key: "rows" | "columns" | "row" | "start" | "end") => (
    <label className="sequence-field">{label}<input type="number" min="1" step="1" value={p.settings[key]} onChange={event => p.setSettings(value => ({ ...value, [key]: event.target.value }))} /></label>
  );
  return <section className="sequence-panel" aria-label="序列动画播放器">
    <div className="sequence-heading"><span><Film size={16} />序列动画</span><button className="icon-button" onClick={onClose} title="关闭序列动画" aria-label="关闭序列动画"><X size={16} /></button></div>
    <div className="sequence-settings">
      {field("行数", "rows")}{field("列数", "columns")}
      <label className="sequence-field">播放范围<select value={p.settings.mode} onChange={event => p.setSettings(value => ({ ...value, mode: event.target.value as RangeMode }))}><option value="all">全部格子</option><option value="row">指定单行</option><option value="custom">起止帧</option></select></label>
      {p.settings.mode === "row" && field("行号", "row")}
      {p.settings.mode === "custom" && <>{field("起始帧", "start")}{field("结束帧", "end")}</>}
      <label className="sequence-field">间隔 · ms<input type="number" min="16" max="2000" step="1" value={p.interval} onChange={event => p.setInterval(event.target.value)} /></label>
      <label className="sequence-speed"><span>{p.intervalValid ? `${(1000 / Number(p.interval)).toFixed(1)} FPS` : "16–2000 ms"}</span><input aria-label="帧间隔" type="range" min="16" max="2000" value={p.intervalValid ? p.interval : 100} onChange={event => p.setInterval(event.target.value)} /></label>
    </div>
    {(p.layout.error || !p.intervalValid) && <p className="sequence-error" role="alert">{p.layout.error || "帧间隔必须是 16–2000 毫秒的整数"}</p>}
    <div className="sequence-playback">
      <button className="icon-button" disabled={!p.valid} title="返回首帧" aria-label="返回首帧" onClick={() => p.seek(p.layout.start!)}><SkipBack size={17} /></button>
      <button className="icon-button" disabled={!p.valid} title="上一帧 (←)" aria-label="上一帧" onClick={() => p.seek(p.frame - 1)}><ChevronLeft size={18} /></button>
      <button className="sequence-play" disabled={!p.valid} onClick={p.toggle} aria-label={p.playing ? "暂停" : "播放"} title="播放 / 暂停 (空格)">{p.playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button className="icon-button" disabled={!p.valid} title="下一帧 (→)" aria-label="下一帧" onClick={() => p.seek(p.frame + 1)}><ChevronRight size={18} /></button>
      <input className="sequence-progress" aria-label="动画帧进度" type="range" disabled={!p.valid} min={p.layout.start ?? 0} max={p.layout.end ?? 0} value={p.frame} onChange={event => p.seek(Number(event.target.value))} />
      <span className="sequence-readout">{p.layout.error ? "—" : `${p.frame + 1} 帧 · ${p.frame - p.layout.start! + 1} / ${p.layout.count}`}</span>
      <label className="sequence-loop"><input type="checkbox" checked={p.loop} onChange={event => p.setLoop(event.target.checked)} />循环</label>
      <span className="sequence-size">{!p.layout.error && `${p.layout.width} × ${p.layout.height} px`}</span>
    </div>
  </section>;
}
