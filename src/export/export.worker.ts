// 書き出し専用ワーカー。
// プレイヤーとは一切やり取りせず、受け取った元ファイルと視野だけから動画を再生成する。
//   元ファイルを多重化解除 → デコード → デワープ描画 → H.264 エンコード → MP4 に多重化（音声は元データをコピー）
import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  VideoSample,
} from "mediabunny";

import { DewarpRenderer } from "../dewarp/DewarpRenderer.ts";
import type { ExportStartMessage, ExportWorkerEvent, ExportWorkerRequest } from "./exportTypes.ts";

const PROGRESS_INTERVAL_MILLISECONDS = 200;

let activeConversion: Conversion | null = null;
let isCancelRequested = false;
/** キャンセル処理（出力ストリームの破棄を含む）の完了を待つための Promise */
let cancellation: Promise<void> | null = null;

function postEvent(event: ExportWorkerEvent): void {
  self.postMessage(event);
}

function cancelActiveConversion(): void {
  if (activeConversion != null && cancellation == null) {
    cancellation = activeConversion.cancel();
  }
}

/** 中断・失敗時に、保存ダイアログで作られた書きかけのファイルを残さないようにする */
async function removeIncompleteOutput(output: FileSystemFileHandle): Promise<void> {
  try {
    // remove() は TypeScript 標準の型定義に無いが、対象のブラウザ（Chrome / Edge）は対応している
    await (output as FileSystemFileHandle & { remove?: () => Promise<void> }).remove?.();
  } catch {
    // 後始末の失敗は本来のエラーより重要ではないため無視する
  }
}

async function runExport(request: ExportStartMessage): Promise<void> {
  const { file, view, width, height, bitrate, output } = request;
  const startTime = performance.now();
  const getElapsedSeconds = (): number => (performance.now() - startTime) / 1000;
  let mediaOutput: Output | null = null;

  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const canvas = new OffscreenCanvas(width, height);
    const renderer = new DewarpRenderer(canvas, { preserveDrawingBuffer: true });
    mediaOutput = new Output({
      // メタデータをファイル末尾に置き、映像データを書き出しの最後までメモリに溜めないようにする
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(await output.createWritable(), { chunked: true }),
    });

    const conversion = await Conversion.init({
      input,
      output: mediaOutput,
      video: {
        codec: "avc",
        quality: new Quality({ bitrate }),
        processedWidth: width,
        processedHeight: height,
        process: (sample) => {
          const frame = sample.toVideoFrame();
          renderer.setFrame(frame, frame.displayWidth, frame.displayHeight);
          renderer.draw(view);
          frame.close();
          // キャンバスは次のフレームで上書きされるため、この時点の内容を映像フレームとして確定させる
          return new VideoSample(canvas, {
            timestamp: sample.timestamp,
            duration: sample.duration,
          });
        },
      },
    });
    const discardedTracks = conversion.discardedTracks.map(
      ({ track, reason }) => `${track.type}: ${reason}`,
    );
    if (!conversion.isValid) {
      throw new Error(
        `この動画は変換できません（${discardedTracks.join(" / ") || "映像トラックがありません"}）。`,
      );
    }

    activeConversion = conversion;
    let lastReportTime = 0;
    conversion.onProgress = (progress) => {
      const now = performance.now();
      if (now - lastReportTime >= PROGRESS_INTERVAL_MILLISECONDS) {
        lastReportTime = now;
        postEvent({ type: "progress", progress, elapsedSeconds: getElapsedSeconds() });
      }
    };
    if (isCancelRequested) {
      // 準備中にキャンセルされた場合。直後の execute() が ConversionCanceledError を投げる
      cancelActiveConversion();
    }

    await conversion.execute();
    postEvent({ type: "done", bytes: (await output.getFile()).size, discardedTracks });
  } catch (error: unknown) {
    // 出力ストリームが閉じてからでないと書きかけのファイルを削除できないため、破棄の完了を待つ
    try {
      await cancellation;
      if (
        mediaOutput != null &&
        mediaOutput.state !== "canceled" &&
        mediaOutput.state !== "finalized"
      ) {
        await mediaOutput.cancel();
      }
    } catch {
      // 破棄に失敗しても、元のエラーを優先して伝える
    }
    await removeIncompleteOutput(output);
    throw error;
  }
}

// このワーカーは 1 回の書き出しごとに作られ、結果を返した直後に終了させられる。
// そのため、メモリ上のリソース（デコーダや WebGL のコンテキスト）は個別に解放していない。
self.onmessage = (event: MessageEvent<ExportWorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    isCancelRequested = true;
    cancelActiveConversion();
    return;
  }

  runExport(request).catch((error: unknown) => {
    if (error instanceof ConversionCanceledError) {
      postEvent({ type: "canceled" });
    } else {
      postEvent({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
};
