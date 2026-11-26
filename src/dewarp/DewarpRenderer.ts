import {
  buildRotationMatrix,
  degreesToRadians,
  FISHEYE_FOV,
  verticalFovFor,
  type DewarpView,
} from "./view.ts";

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 aPosition;
out vec2 vScreen;

void main() {
  // 画面の上端を -1 とする（視線ベクトルの計算で y を下向きに扱うため）
  vScreen = vec2(aPosition.x, -aPosition.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform mat3 uRotation;
// (tan(水平画角 / 2), tan(垂直画角 / 2))
uniform vec2 uTanHalfFov;
// 魚眼レンズの画角（ラジアン）。イメージサークルの直径がこの角度に対応する
uniform float uFisheyeFov;
// イメージサークルの直径 ÷ 入力映像の幅・高さ
uniform vec2 uCircleScale;

in vec2 vScreen;
out vec4 outColor;

// イメージサークルの半径（直径を 1 とした単位）
const float CIRCLE_RADIUS = 0.5;

void main() {
  // 出力画素 → 視線ベクトル（x: 右、y: 下、z: 光軸方向）
  vec3 ray = uRotation * normalize(vec3(uTanHalfFov * vScreen, 1.0));

  // 視線ベクトル → 魚眼画像上の位置。等距離射影なので、像の中心からの距離が光軸からの角度に比例する
  float planarLength = length(ray.xy);
  float radius = atan(planarLength, ray.z) / uFisheyeFov;
  if (radius > CIRCLE_RADIUS) {
    // レンズに写っていない方向
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 direction = planarLength > 0.0 ? ray.xy / planarLength : vec2(0.0);
  vec2 uv = vec2(0.5) + direction * radius * uCircleScale;
  outColor = vec4(texture(uSource, uv).rgb, 1.0);
}`;

/** 画面全体を覆う 1 枚の三角形 */
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);
const UNIFORM_NAMES = [
  "uSource",
  "uRotation",
  "uTanHalfFov",
  "uFisheyeFov",
  "uCircleScale",
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];

export interface DewarpRendererOptions {
  /**
   * 描画結果を次の描画まで保持するか。
   * 描画直後のキャンバスから映像フレームを作る書き出し処理では true にする。
   */
  preserveDrawingBuffer?: boolean;
}

/**
 * 円周魚眼（等距離射影）の映像を、指定した視野の平面映像へ変換して描画する。
 *
 * プレイヤーのプレビューと書き出しの両方で同じ描画を使うため、通常のキャンバスと OffscreenCanvas のどちらでも動く。
 */
export class DewarpRenderer {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly uniforms: Record<UniformName, WebGLUniformLocation | null>;
  private sourceWidth = 0;
  private sourceHeight = 0;

  /** @throws WebGL2 が使えない場合、またはシェーダーの準備に失敗した場合 */
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, options: DewarpRendererOptions = {}) {
    this.canvas = canvas;
    // 2 種類のキャンバスで getContext の型定義が異なるため、片方の型として呼び出す
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (gl == null) {
      throw new Error("WebGL2 を利用できません。");
    }
    this.gl = gl;

    this.program = this.createProgram();
    gl.useProgram(this.program);
    this.uniforms = Object.fromEntries(
      UNIFORM_NAMES.map((name) => [name, gl.getUniformLocation(this.program, name)]),
    ) as Record<UniformName, WebGLUniformLocation | null>;

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
    const positionLocation = gl.getAttribLocation(this.program, "aPosition");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniforms.uSource, 0);

    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  /** 描画できる入力フレームを保持しているか */
  get hasFrame(): boolean {
    return this.sourceWidth > 0 && this.sourceHeight > 0;
  }

  /** 描画先の画素数を変更する */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  /**
   * 入力フレーム（魚眼映像）を取り込む
   *
   * @param width 入力フレームの幅（画素）
   * @param height 入力フレームの高さ（画素）
   */
  setFrame(source: TexImageSource, width: number, height: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.sourceWidth = width;
    this.sourceHeight = height;
  }

  /** 取り込み済みの入力フレームを、指定した視野で描画する。入力フレームが無ければ何もしない */
  draw(view: DewarpView): void {
    if (!this.hasFrame || this.canvas.width === 0 || this.canvas.height === 0) {
      return;
    }

    const gl = this.gl;
    const verticalFov = verticalFovFor(view.horizontalFov, this.canvas.width / this.canvas.height);
    const circleDiameter = Math.min(this.sourceWidth, this.sourceHeight);
    gl.uniformMatrix3fv(this.uniforms.uRotation, false, buildRotationMatrix(view));
    gl.uniform2f(
      this.uniforms.uTanHalfFov,
      Math.tan(degreesToRadians(view.horizontalFov) / 2),
      Math.tan(degreesToRadians(verticalFov) / 2),
    );
    gl.uniform1f(this.uniforms.uFisheyeFov, degreesToRadians(FISHEYE_FOV));
    gl.uniform2f(
      this.uniforms.uCircleScale,
      circleDiameter / this.sourceWidth,
      circleDiameter / this.sourceHeight,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** GPU 上のリソースを解放する */
  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteProgram(this.program);
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    const shaders = [
      this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE),
      this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE),
    ];
    for (const shader of shaders) {
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    for (const shader of shaders) {
      // リンク後はシェーダー単体を保持する必要がない
      gl.deleteShader(shader);
    }
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`シェーダーのリンクに失敗しました: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  private compileShader(type: GLenum, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (shader == null) {
      throw new Error("シェーダーを作成できません。");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`シェーダーのコンパイルに失敗しました: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }
}
