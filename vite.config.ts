import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages のサブパスでもそのまま動くよう、アセットを相対パスで参照する
  base: "./",
  plugins: [react()],
  // 書き出しワーカーはモジュールとして読み込む
  worker: { format: "es" },
  // mediabunny は書き出しワーカーからしか参照されず、開発サーバーの起動時には検出されない。
  // 初めて保存したときに検出されるとページが再読み込みされて保存が中断するため、あらかじめ含めておく
  optimizeDeps: { include: ["mediabunny"] },
});
