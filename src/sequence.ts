export type RangeMode = "all" | "row" | "custom";
export interface SequenceSettings {
  rows: string;
  columns: string;
  mode: RangeMode;
  row: string;
  start: string;
  end: string;
}

export function sequenceLayout(width: number, height: number, settings: SequenceSettings) {
  const rows = Number(settings.rows), columns = Number(settings.columns);
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  if (!positive(rows) || !positive(columns)) return { error: "行数和列数必须是正整数" } as const;
  if (!width || !height) return { error: "正在加载图片…" } as const;
  if (width % columns || height % rows) return { error: "图片宽度必须能被列数整除，高度必须能被行数整除" } as const;
  const total = rows * columns;
  let start = 0, end = total - 1;
  if (settings.mode === "row") {
    const row = Number(settings.row);
    if (!positive(row) || row > rows) return { error: `行号应为 1–${rows}` } as const;
    start = (row - 1) * columns;
    end = start + columns - 1;
  } else if (settings.mode === "custom") {
    start = Number(settings.start) - 1;
    end = Number(settings.end) - 1;
    if (!positive(start + 1) || !positive(end + 1) || start > end || end >= total) {
      return { error: `起止帧应为 1–${total}，且起始帧不大于结束帧` } as const;
    }
  }
  return { error: "", columns, width: width / columns, height: height / rows, start, end, count: end - start + 1 } as const;
}

export function frameRect(frame: number, columns: number, width: number, height: number) {
  return { x: (frame % columns) * width, y: Math.floor(frame / columns) * height, width, height };
}

export function advanceFrame(frame: number, steps: number, start: number, end: number, loop: boolean) {
  return loop ? start + ((frame - start + steps) % (end - start + 1)) : Math.min(end, frame + steps);
}
