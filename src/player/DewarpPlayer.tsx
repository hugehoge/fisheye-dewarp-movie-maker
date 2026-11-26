import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { DewarpRenderer } from "../dewarp/DewarpRenderer.ts";
import { degreesToRadians, normalizeView, type DewarpView } from "../dewarp/view.ts";

/** 高精細ディスプレイでも描画負荷が上がりすぎないようにする上限 */
const MAX_DEVICE_PIXEL_RATIO = 2;
/** ホイールの回転量に対する画角の変化の速さ */
const WHEEL_ZOOM_RATE = 0.0015;
/** 天井付けで真下付近を見ているときに、パン操作が過敏になりすぎないようにする下限 */
const MIN_PAN_LEVERAGE = 0.25;
const SECONDS_PER_MINUTE = 60;

interface DewarpPlayerProps {
  file: File;
  view: DewarpView;
  onViewChange: (view: DewarpView) => void;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
}

function formatTime(seconds: number): string {
  const totalSeconds = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

/**
 * 魚眼動画を再生し、デワープした映像を表示するプレイヤー。
 * 映像上のドラッグでパン・チルト、ホイールで画角を変えられる。
 */
export function DewarpPlayer({ file, view, onViewChange }: DewarpPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DewarpRenderer | null>(null);
  // 映像フレームの更新やポインター操作は React の再描画を待たずに起きるため、最新の視野を別に保持する
  const viewRef = useRef(view);
  const dragRef = useRef<DragState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    viewRef.current = view;
    rendererRef.current?.draw(view);
  }, [view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) {
      return;
    }

    let renderer: DewarpRenderer;
    try {
      renderer = new DewarpRenderer(canvas);
    } catch (error: unknown) {
      // 画面への表示は、動画を読み込んだ時点で行う（handleLoadedMetadata）
      console.error(error);
      return;
    }
    rendererRef.current = renderer;

    // 表示サイズが変わったら、描画の画素数を追従させて描き直す
    const resizeObserver = new ResizeObserver(() => {
      const pixelRatio = Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO);
      renderer.resize(
        Math.round(canvas.clientWidth * pixelRatio),
        Math.round(canvas.clientHeight * pixelRatio),
      );
      renderer.draw(viewRef.current);
    });
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video == null) {
      return;
    }

    const url = URL.createObjectURL(file);
    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const video = videoRef.current;
    if (video == null) {
      return;
    }

    const drawCurrentFrame = (): void => {
      const renderer = rendererRef.current;
      if (
        renderer == null ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0
      ) {
        return;
      }
      renderer.setFrame(video, video.videoWidth, video.videoHeight);
      renderer.draw(viewRef.current);
    };

    // 再生中は、映像のフレームが切り替わるたびに描画する
    const onVideoFrame = (): void => {
      drawCurrentFrame();
      callbackId = video.requestVideoFrameCallback(onVideoFrame);
    };
    let callbackId = video.requestVideoFrameCallback(onVideoFrame);

    // 読み込み直後や一時停止中のシークなど、再生していないときにも表示を更新する
    video.addEventListener("loadeddata", drawCurrentFrame);
    video.addEventListener("seeked", drawCurrentFrame);

    return () => {
      video.cancelVideoFrameCallback(callbackId);
      video.removeEventListener("loadeddata", drawCurrentFrame);
      video.removeEventListener("seeked", drawCurrentFrame);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) {
      return;
    }

    // React 経由のホイールイベントはスクロールを止められない設定で登録されるため、直接登録する
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const current = viewRef.current;
      const next = normalizeView({
        ...current,
        horizontalFov: current.horizontalFov * Math.exp(event.deltaY * WHEEL_ZOOM_RATE),
      });
      viewRef.current = next;
      onViewChange(next);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [onViewChange]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== event.pointerId) {
      return;
    }

    const current = viewRef.current;
    const degreesPerPixel = current.horizontalFov / event.currentTarget.clientWidth;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = { pointerId: drag.pointerId, x: event.clientX, y: event.clientY };

    // 天井付けのパンは光軸まわりの回転で、真下に近いほど同じ角度でも画面上の動きが小さい。その分だけ大きく回す
    const panLeverage =
      current.mount === "ceiling"
        ? Math.max(Math.sin(degreesToRadians(current.tilt)), MIN_PAN_LEVERAGE)
        : 1;
    // 掴んだ映像がポインターについてくる向きに動かす（右へドラッグすると左を向く）
    const next = normalizeView({
      ...current,
      pan: current.pan - (deltaX * degreesPerPixel) / panLeverage,
      tilt: current.tilt + deltaY * degreesPerPixel,
    });
    viewRef.current = next;
    onViewChange(next);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const handleTogglePlayback = (): void => {
    const video = videoRef.current;
    if (video == null) {
      return;
    }
    if (video.paused) {
      video.play().catch((error: unknown) => {
        // 再生開始の直後に一時停止した場合の中断は正常な動作なので通知しない
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setErrorMessage("この動画を再生できません。");
        }
      });
    } else {
      video.pause();
    }
  };

  const handleSeek = (event: ChangeEvent<HTMLInputElement>): void => {
    const video = videoRef.current;
    if (video == null) {
      return;
    }
    const time = Number(event.target.value);
    video.currentTime = time;
    setCurrentTime(time);
  };

  const handleLoadedMetadata = (): void => {
    const video = videoRef.current;
    if (video == null) {
      return;
    }
    setDuration(video.duration);
    if (rendererRef.current == null) {
      setErrorMessage("映像を描画できません。このブラウザでは WebGL2 を利用できません。");
    }
  };

  const isLoaded = duration > 0;

  return (
    <section className="player">
      <div className="player-stage">
        <video
          ref={videoRef}
          className="player-source"
          playsInline
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={() =>
            setErrorMessage(
              "この動画を読み込めません。ブラウザが対応していない形式の可能性があります。",
            )
          }
        />
        <canvas
          ref={canvasRef}
          className="player-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />
        {errorMessage != null && (
          <p className="player-message" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
      <div className="player-controls">
        <button type="button" onClick={handleTogglePlayback} disabled={!isLoaded}>
          {isPlaying ? "一時停止" : "再生"}
        </button>
        <input
          type="range"
          aria-label="再生位置"
          min={0}
          max={isLoaded ? duration : 0}
          step="any"
          value={currentTime}
          onChange={handleSeek}
          disabled={!isLoaded}
        />
        <span className="player-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </section>
  );
}
