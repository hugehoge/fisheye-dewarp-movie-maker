import { describe, expect, it } from "vitest";

import {
  buildRotationMatrix,
  createDefaultView,
  normalizeView,
  verticalFovFor,
  type DewarpView,
} from "./view.ts";

/** 回転行列（列優先）から、光軸方向 (0, 0, 1) を回転した結果を取り出す */
function viewDirection(view: DewarpView): number[] {
  return Array.from(buildRotationMatrix(view).slice(6, 9));
}

function expectVector(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
}

describe("verticalFovFor", () => {
  it("水平画角と縦横比から、画素が正方形になる垂直画角を求める", () => {
    expect(verticalFovFor(90, 16 / 9)).toBeCloseTo(58.7155, 3);
    expect(verticalFovFor(90, 1)).toBeCloseTo(90, 6);
  });
});

describe("normalizeView", () => {
  const ceiling = createDefaultView("ceiling");
  const wall = createDefaultView("wall");

  it("天井付けのパンは、範囲の両端の値をそのまま保つ", () => {
    expect(normalizeView({ ...ceiling, pan: -180 }).pan).toBe(-180);
    expect(normalizeView({ ...ceiling, pan: 180 }).pan).toBe(180);
  });

  it("天井付けのパンは、範囲を超えると反対側へ折り返す", () => {
    expect(normalizeView({ ...ceiling, pan: 190 }).pan).toBe(-170);
    expect(normalizeView({ ...ceiling, pan: -190 }).pan).toBe(170);
  });

  it("壁付けのパンとチルト、画角は、範囲の端で止まる", () => {
    expect(normalizeView({ ...wall, pan: 120, tilt: -120, horizontalFov: 10 })).toEqual({
      mount: "wall",
      pan: 90,
      tilt: -90,
      horizontalFov: 30,
    });
  });
});

describe("buildRotationMatrix", () => {
  it("壁付けの正面は、光軸の向きのまま", () => {
    expectVector(viewDirection({ mount: "wall", pan: 0, tilt: 0, horizontalFov: 90 }), [0, 0, 1]);
  });

  it("壁付けでは、パンで右、チルトで上を向く", () => {
    expectVector(viewDirection({ mount: "wall", pan: 90, tilt: 0, horizontalFov: 90 }), [1, 0, 0]);
    expectVector(viewDirection({ mount: "wall", pan: 0, tilt: 90, horizontalFov: 90 }), [0, -1, 0]);
  });

  it("天井付けでは、チルト 90° で水平を向き、パンで光軸のまわりを回る", () => {
    expectVector(
      viewDirection({ mount: "ceiling", pan: 0, tilt: 90, horizontalFov: 90 }),
      [0, -1, 0],
    );
    expectVector(
      viewDirection({ mount: "ceiling", pan: 90, tilt: 90, horizontalFov: 90 }),
      [1, 0, 0],
    );
  });
});
