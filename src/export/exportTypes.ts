import type { DewarpView } from "../dewarp/view.ts";

/** 出力映像の解像度とビットレートの組み合わせ（縦横比は 16:9 固定） */
export interface ExportPreset {
  id: string;
  width: number;
  height: number;
  /**
   * 映像のビットレート（bps）。30 fps の映像での目安。
   * エンコーダは 30 fps を前提に 1 フレームあたりの割り当てを決めるため、実際の値は元のフレームレートに比例して増減する。
   */
  bitrate: number;
}

/** 先頭が既定の選択肢 */
export const EXPORT_PRESETS: readonly ExportPreset[] = [
  { id: "1080p", width: 1920, height: 1080, bitrate: 8_000_000 },
  { id: "720p", width: 1280, height: 720, bitrate: 5_000_000 },
  { id: "480p", width: 854, height: 480, bitrate: 2_500_000 },
];

export interface ExportStartMessage {
  type: "start";
  /** 元の動画ファイル */
  file: File;
  /** 書き出し開始時点の視野 */
  view: DewarpView;
  width: number;
  height: number;
  bitrate: number;
  /** 保存ダイアログで選ばれた出力先 */
  output: FileSystemFileHandle;
}

/** メインスレッドから書き出しワーカーへ送るメッセージ */
export type ExportWorkerRequest = ExportStartMessage | { type: "cancel" };

export interface ExportProgress {
  /** 進捗（0〜1） */
  progress: number;
  /** 書き出し開始からの経過時間（秒） */
  elapsedSeconds: number;
}

export interface ExportSummary {
  /** 出力ファイルのサイズ（バイト） */
  bytes: number;
  /** 出力に含められなかったトラックの説明（例: 変換できない音声） */
  discardedTracks: string[];
}

/** 書き出しワーカーからメインスレッドへ送るメッセージ */
export type ExportWorkerEvent =
  | ({ type: "progress" } & ExportProgress)
  | ({ type: "done" } & ExportSummary)
  | { type: "canceled" }
  | { type: "error"; message: string };
