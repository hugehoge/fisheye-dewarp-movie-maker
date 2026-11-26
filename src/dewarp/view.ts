/** カメラの設置方向。パン・チルトが指す向きはこれで決まる */
export type MountPosition = "ceiling" | "wall";

/** デワープ後の視野。角度の単位はすべて度 */
export interface DewarpView {
  mount: MountPosition;
  /** 左右の向き。正の値で右を向く */
  pan: number;
  /**
   * 上下の向き。
   * 天井付け: 0 で真下（魚眼の中心）、90 で水平方向。
   * 壁付け: 0 で正面（魚眼の中心）、正の値で上を向く。
   */
  tilt: number;
  /** 水平画角 */
  horizontalFov: number;
}

export interface AngleRange {
  min: number;
  max: number;
}

/** 魚眼レンズの画角。イメージサークルの直径がこの角度に対応する */
export const FISHEYE_FOV = 180;
export const HORIZONTAL_FOV_RANGE: AngleRange = { min: 30, max: 120 };

const DEFAULT_HORIZONTAL_FOV = 90;
const HALF_TURN = 180;
const FULL_TURN = 360;

export const PAN_RANGE: Record<MountPosition, AngleRange> = {
  ceiling: { min: -180, max: 180 },
  wall: { min: -90, max: 90 },
};

export const TILT_RANGE: Record<MountPosition, AngleRange> = {
  ceiling: { min: 0, max: 90 },
  wall: { min: -90, max: 90 },
};

export function createDefaultView(mount: MountPosition): DewarpView {
  if (mount === "ceiling") {
    // 真下は魚眼の中心で歪みが少ないため、斜め下を見下ろす向きから始める
    return { mount, pan: 0, tilt: 45, horizontalFov: DEFAULT_HORIZONTAL_FOV };
  } else {
    return { mount, pan: 0, tilt: 0, horizontalFov: DEFAULT_HORIZONTAL_FOV };
  }
}

/** 各値を設置方向ごとの有効範囲に収めた視野を返す */
export function normalizeView(view: DewarpView): DewarpView {
  const tiltRange = TILT_RANGE[view.mount];
  const panRange = PAN_RANGE[view.mount];
  return {
    mount: view.mount,
    // 天井付けは一周できるので範囲を超えた分を反対側へ折り返し、壁付けは端で止める
    pan:
      view.mount === "ceiling" ? wrapAngle(view.pan) : clamp(view.pan, panRange.min, panRange.max),
    tilt: clamp(view.tilt, tiltRange.min, tiltRange.max),
    horizontalFov: clamp(view.horizontalFov, HORIZONTAL_FOV_RANGE.min, HORIZONTAL_FOV_RANGE.max),
  };
}

/** 画素が正方形になる垂直画角を、水平画角と縦横比から求める */
export function verticalFovFor(horizontalFov: number, aspectRatio: number): number {
  return radiansToDegrees(
    2 * Math.atan(Math.tan(degreesToRadians(horizontalFov) / 2) / aspectRatio),
  );
}

/**
 * 視野の向きを表す 3×3 の回転行列を、GLSL の mat3 にそのまま渡せる列優先の配列で返す。
 *
 * 座標系は x: 右、y: 下、z: 光軸方向（魚眼の中心が写している向き）。
 * どちらの設置方向でも、視線をチルトで傾けてから、鉛直な軸のまわりにパンで回す。
 * 鉛直な軸は、壁付けでは y 軸、天井付けでは光軸（z 軸）にあたる。
 */
export function buildRotationMatrix(view: DewarpView): Float32Array {
  const tiltRotation = rotationAroundX(view.tilt);
  const panRotation =
    view.mount === "ceiling" ? rotationAroundZ(view.pan) : rotationAroundY(view.pan);
  const rotation = multiplyMatrices(panRotation, tiltRotation);
  const elements = new Float32Array(9);
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      elements[column * 3 + row] = rotation[row][column];
    }
  }
  return elements;
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / HALF_TURN;
}

function radiansToDegrees(radians: number): number {
  return (radians * HALF_TURN) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** -180〜180 の範囲を超えた角度を、同じ向きを表す範囲内の値へ折り返す */
function wrapAngle(degrees: number): number {
  if (degrees >= -HALF_TURN && degrees <= HALF_TURN) {
    // 両端の -180 と 180 は同じ向きだが、スライダーのつまみが反対の端へ飛ばないよう、どちらもそのまま返す
    return degrees;
  }
  return ((((degrees + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN;
}

/** 行優先の 3×3 行列 */
type Matrix3 = [number[], number[], number[]];

function rotationAroundX(degrees: number): Matrix3 {
  const cos = Math.cos(degreesToRadians(degrees));
  const sin = Math.sin(degreesToRadians(degrees));
  return [
    [1, 0, 0],
    [0, cos, -sin],
    [0, sin, cos],
  ];
}

function rotationAroundY(degrees: number): Matrix3 {
  const cos = Math.cos(degreesToRadians(degrees));
  const sin = Math.sin(degreesToRadians(degrees));
  return [
    [cos, 0, sin],
    [0, 1, 0],
    [-sin, 0, cos],
  ];
}

function rotationAroundZ(degrees: number): Matrix3 {
  const cos = Math.cos(degreesToRadians(degrees));
  const sin = Math.sin(degreesToRadians(degrees));
  return [
    [cos, -sin, 0],
    [sin, cos, 0],
    [0, 0, 1],
  ];
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  const product: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      for (let inner = 0; inner < 3; inner++) {
        product[row][column] += left[row][inner] * right[inner][column];
      }
    }
  }
  return product;
}
