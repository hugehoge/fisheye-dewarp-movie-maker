import { useEffect, useRef, useState } from "react";

import type { DewarpView } from "../dewarp/view.ts";
import { chooseOutputFile, startExport, type ExportJob } from "./exportClient.ts";
import {
  EXPORT_PRESETS,
  type ExportPreset,
  type ExportProgress,
  type ExportSummary,
} from "./exportTypes.ts";

const OUTPUT_NAME_SUFFIX = "_dewarp.mp4";
const BITS_PER_MEGABIT = 1_000_000;
const BYTES_PER_MEGABYTE = 1_000_000;
const SECONDS_PER_MINUTE = 60;

interface ExportPanelProps {
  file: File;
  view: DewarpView;
}

type ExportState =
  | { status: "idle" }
  | ({ status: "running" } & ExportProgress)
  | { status: "done"; summary: ExportSummary }
  | { status: "canceled" }
  | { status: "error"; message: string };

function buildOutputName(sourceName: string): string {
  return `${sourceName.replace(/\.[^.]+$/, "")}${OUTPUT_NAME_SUFFIX}`;
}

function formatPreset(preset: ExportPreset): string {
  return `${preset.width}×${preset.height}（${preset.bitrate / BITS_PER_MEGABIT} Mbps）`;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  return minutes > 0
    ? `${minutes} 分 ${totalSeconds % SECONDS_PER_MINUTE} 秒`
    : `${totalSeconds} 秒`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 現在の視野でデワープした動画を保存するパネル。
 * 専用ワーカーが元ファイルから動画を再生成するため、プレイヤーの再生・停止や、保存を始めた後の視野の変更には影響されない。
 */
export function ExportPanel({ file, view }: ExportPanelProps) {
  const [presetId, setPresetId] = useState(EXPORT_PRESETS[0].id);
  const [state, setState] = useState<ExportState>({ status: "idle" });
  const jobRef = useRef<ExportJob | null>(null);

  // 画面を離れるときに書き出しが残らないようにする
  useEffect(() => () => jobRef.current?.cancel(), []);

  const isRunning = state.status === "running";

  const handleExport = async (): Promise<void> => {
    const preset =
      EXPORT_PRESETS.find((candidate) => candidate.id === presetId) ?? EXPORT_PRESETS[0];
    let output: FileSystemFileHandle | null;
    try {
      // 保存ダイアログはユーザー操作の直後にしか開けないため、他の処理より先に呼ぶ
      output = await chooseOutputFile(buildOutputName(file.name));
    } catch (error: unknown) {
      setState({ status: "error", message: toErrorMessage(error) });
      return;
    }
    if (output == null) {
      return;
    }

    setState({ status: "running", progress: 0, elapsedSeconds: 0 });
    const job = startExport(
      {
        file,
        // 保存中に視野を動かしても結果が変わらないよう、開始時点の値を渡す
        view: { ...view },
        width: preset.width,
        height: preset.height,
        bitrate: preset.bitrate,
        output,
      },
      (progress) => setState({ status: "running", ...progress }),
    );
    jobRef.current = job;

    try {
      const result = await job.result;
      setState(
        result.status === "canceled" ? { status: "canceled" } : { status: "done", summary: result },
      );
    } catch (error: unknown) {
      setState({ status: "error", message: toErrorMessage(error) });
    } finally {
      jobRef.current = null;
    }
  };

  return (
    <section className="panel">
      <h2>動画の変換</h2>
      <label className="field">
        <span>解像度</span>
        <select
          value={presetId}
          onChange={(event) => setPresetId(event.target.value)}
          disabled={isRunning}
        >
          {EXPORT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {formatPreset(preset)}
            </option>
          ))}
        </select>
      </label>

      {isRunning ? (
        <div className="export-progress">
          <progress value={state.progress} max={1} />
          <p>
            {Math.round(state.progress * 100)}%（経過 {formatDuration(state.elapsedSeconds)}
            {state.progress > 0 &&
              `、残り約 ${formatDuration((state.elapsedSeconds * (1 - state.progress)) / state.progress)}`}
            ）
          </p>
          <button type="button" onClick={() => jobRef.current?.cancel()}>
            キャンセル
          </button>
        </div>
      ) : (
        <button type="button" className="primary" onClick={() => void handleExport()}>
          現在の視野に変換して保存
        </button>
      )}

      {state.status === "done" && (
        <p className="message" role="status">
          保存しました（{(state.summary.bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB）。
          {state.summary.discardedTracks.length > 0 &&
            ` 出力に含められなかったトラックがあります（${state.summary.discardedTracks.join(" / ")}）。`}
        </p>
      )}
      {state.status === "canceled" && (
        <p className="message" role="status">
          保存をキャンセルしました。
        </p>
      )}
      {state.status === "error" && (
        <p className="message error" role="alert">
          保存に失敗しました: {state.message}
        </p>
      )}
    </section>
  );
}
