import type {
  ExportProgress,
  ExportStartMessage,
  ExportSummary,
  ExportWorkerEvent,
  ExportWorkerRequest,
} from "./exportTypes.ts";

declare global {
  interface Window {
    // 保存ダイアログ（File System Access API）は TypeScript 標準の型定義に含まれないため補う
    showSaveFilePicker(options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle>;
  }
}

export type ExportParameters = Omit<ExportStartMessage, "type">;

export type ExportResult = ({ status: "done" } & ExportSummary) | { status: "canceled" };

export interface ExportJob {
  /** 書き出しを中断する。中断が完了すると `result` が `canceled` で解決する */
  cancel(): void;
  /** 書き出しの結果。失敗した場合は Error で reject される */
  result: Promise<ExportResult>;
}

/**
 * 保存ダイアログを開いて、出力先のファイルを選んでもらう。
 * ダイアログはユーザー操作の直後にしか開けないため、ボタンのクリックなどのハンドラから直接呼ぶこと。
 *
 * @returns 出力先。ダイアログが閉じられた場合は null
 */
export async function chooseOutputFile(
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: "MP4 動画", accept: { "video/mp4": [".mp4"] } }],
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}

/** 専用ワーカーで書き出しを開始する。プレイヤーの再生状態には影響されない */
export function startExport(
  parameters: ExportParameters,
  onProgress: (progress: ExportProgress) => void,
): ExportJob {
  const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  const post = (request: ExportWorkerRequest): void => worker.postMessage(request);

  const result = new Promise<ExportResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ExportWorkerEvent>) => {
      const message = event.data;
      switch (message.type) {
        case "progress":
          onProgress({ progress: message.progress, elapsedSeconds: message.elapsedSeconds });
          break;
        case "done":
          resolve({
            status: "done",
            bytes: message.bytes,
            discardedTracks: message.discardedTracks,
          });
          break;
        case "canceled":
          resolve({ status: "canceled" });
          break;
        case "error":
          reject(new Error(message.message));
          break;
      }
    };
    worker.onerror = (event) =>
      reject(new Error(event.message || "書き出しワーカーでエラーが発生しました。"));
  }).finally(() => worker.terminate());

  post({ type: "start", ...parameters });
  return {
    cancel: () => post({ type: "cancel" }),
    result,
  };
}
