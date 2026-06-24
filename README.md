# EchoMap

会話をリアルタイムで文字起こしし、要約・論理構造マップ・用語解説を生成するWebアプリ。

## 構成

- フロントエンド: React + Vite + React Flow
- バックエンド: Cloudflare Pages Functions
- 文字起こし: Cloudflare Workers AI（Whisper）
- 会話解析: Cloudflare Workers AI（gpt-oss-20b + JSON Mode）
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

- `TRANSCRIBE_MODEL`: 既定値は`@cf/openai/whisper`
- `ANALYSIS_MODEL`: 既定値は`@cf/openai/gpt-oss-20b`

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
