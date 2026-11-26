import { useState, type ChangeEvent, type DragEvent } from "react";

import { createDefaultView, type DewarpView } from "./dewarp/view.ts";
import { ExportPanel } from "./export/ExportPanel.tsx";
import { DewarpPlayer } from "./player/DewarpPlayer.tsx";
import { ViewControls } from "./player/ViewControls.tsx";

interface LoadedVideo {
  file: File;
  /** 同じファイルを選び直したときにもプレイヤーを作り直すための連番 */
  sequence: number;
}

function App() {
  const [video, setVideo] = useState<LoadedVideo | null>(null);
  const [view, setView] = useState<DewarpView>(() => createDefaultView("ceiling"));
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const loadVideo = (file: File): void => {
    setVideo((previous) => ({ file, sequence: (previous?.sequence ?? 0) + 1 }));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file != null) {
      loadVideo(file);
    }
    // 同じファイルを続けて選んでも変更として検知されるよう、選択状態を空に戻す
    event.target.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDraggingOver(false);
    const file = event.dataTransfer.files[0];
    if (file != null) {
      loadVideo(file);
    }
  };

  return (
    <div
      className={isDraggingOver ? "app dragging-over" : "app"}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <header className="app-header">
        <h1>Fisheye Dewarp Movie Maker</h1>
        <label className="file-button">
          動画ファイルを選択
          <input type="file" accept="video/*" onChange={handleFileChange} />
        </label>
        {video != null && <span className="file-name">{video.file.name}</span>}
      </header>

      {video == null ? (
        <main className="empty-state">
          <p>円周魚眼カメラで撮影した動画ファイルを選択するか、この画面にドロップしてください。</p>
          <p className="hint">動画はこのブラウザの中だけで処理され、外部には送信されません。</p>
        </main>
      ) : (
        <main className="workspace">
          <DewarpPlayer key={video.sequence} file={video.file} view={view} onViewChange={setView} />
          <aside className="sidebar">
            <ViewControls view={view} onViewChange={setView} />
            <ExportPanel file={video.file} view={view} />
          </aside>
        </main>
      )}

      <footer className="app-footer">
        <span>対応ブラウザ: パソコン版の Chrome / Edge</span>
        <a href="licenses.txt" target="_blank" rel="noreferrer">
          ライセンス
        </a>
      </footer>
    </div>
  );
}

export default App;
