# EchoMap

会話をリアルタイムで文字起こしし、要約・論理構造マップ・用語解説を生成するWebアプリ。

## 構成

- フロントエンド: React + Vite + React Flow
- バックエンド: Cloudflare Pages Functions
- 文字起こし: Cloudflare Workers AI（Whisper Large v3 Turbo）
- 会話解析: Cloudflare Workers AI（Qwen3 MoE + JSON Mode）
- API保護: Cloudflare KVによるIP単位のレート制限

AI処理はCloudflare内で完結し、ブラウザへAPIキーを配布しない。

## ローカル実行

前提: Node.js 20以上

```bash
npm install
npm run dev
```

Workers AIはCloudflareアカウントへ接続して実行される。`npm run dev:vite`はフロントエンド単体確認用で、`/api/*`は動作しない。

## モデル設定

`wrangler.jsonc`の以下の変数で変更できる。

- `TRANSCRIBE_MODEL`: 既定値は`@cf/openai/whisper-large-v3-turbo`
- `ANALYSIS_MODEL`: 既定値は`@cf/qwen/qwen3-30b-a3b-fp8`

## デプロイ

Cloudflare Pagesプロジェクト名は`douji-rokuon`、Productionブランチは`main`。

```bash
npm run lint
npm run build
wrangler pages deploy dist --project-name douji-rokuon --branch main
```

## 現在の制約

- 録音音声ファイルは保存しない
- 話者分離は未対応
- 会話履歴はブラウザを更新すると消える
- 標準認識はブラウザ依存。対応しない場合は高精度AI認識を使用する
- 高精度AI認識は10秒単位（省通信モードは15秒単位）で反映する
