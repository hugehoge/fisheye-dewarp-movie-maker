import {
  createDefaultView,
  HORIZONTAL_FOV_RANGE,
  normalizeView,
  PAN_RANGE,
  TILT_RANGE,
  type AngleRange,
  type DewarpView,
  type MountPosition,
} from "../dewarp/view.ts";

const MOUNT_OPTIONS: readonly { value: MountPosition; label: string }[] = [
  { value: "ceiling", label: "天井付け（下向き）" },
  { value: "wall", label: "壁付け（横向き）" },
];

interface ViewControlsProps {
  view: DewarpView;
  onViewChange: (view: DewarpView) => void;
}

interface AngleSliderProps {
  label: string;
  value: number;
  range: AngleRange;
  onChange: (value: number) => void;
}

function AngleSlider({ label, value, range, onChange }: AngleSliderProps) {
  return (
    <label className="angle-slider">
      <span className="angle-slider-label">{label}</span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="angle-slider-value">{Math.round(value)}°</output>
    </label>
  );
}

/** 視野（設置方向・パン・チルト・画角）を数値で調整するパネル */
export function ViewControls({ view, onViewChange }: ViewControlsProps) {
  const updateView = (changes: Partial<DewarpView>): void => {
    onViewChange(normalizeView({ ...view, ...changes }));
  };

  return (
    <section className="panel">
      <h2>視野</h2>
      <fieldset className="mount-options">
        <legend>カメラの設置方向</legend>
        {MOUNT_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="mount"
              value={option.value}
              checked={view.mount === option.value}
              // 設置方向でパン・チルトの意味が変わるため、向きは既定値に戻して画角だけ引き継ぐ
              onChange={() =>
                onViewChange({
                  ...createDefaultView(option.value),
                  horizontalFov: view.horizontalFov,
                })
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <AngleSlider
        label="パン"
        value={view.pan}
        range={PAN_RANGE[view.mount]}
        onChange={(pan) => updateView({ pan })}
      />
      <AngleSlider
        label="チルト"
        value={view.tilt}
        range={TILT_RANGE[view.mount]}
        onChange={(tilt) => updateView({ tilt })}
      />
      <AngleSlider
        label="画角"
        value={view.horizontalFov}
        range={HORIZONTAL_FOV_RANGE}
        onChange={(horizontalFov) => updateView({ horizontalFov })}
      />
      <button type="button" onClick={() => onViewChange(createDefaultView(view.mount))}>
        視野をリセット
      </button>
      <p className="hint">映像をドラッグすると、パン・チルト、ホイールで画角を変えられます。</p>
    </section>
  );
}
