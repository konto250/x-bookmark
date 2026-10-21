# ポストノート / x-bookmark

Xのポストをブックマークレットから取り込み、本文とリンク先の内容をOpenAI APIで分類して、タグと一緒にブラウザーへ保存するアプリです。

公開URL: https://x-bookmark-lemon.vercel.app

## 使い方

1. アプリの「AI設定」で、管理者が設定したアプリ用アクセスコードを入力します。認証はHttpOnly Cookieで30日間保持します。
2. 「ブックマークレットを設定」を開き、「ポストノートに保存」をブラウザーのブックマークバーへドラッグします。
3. Xで保存したいポストの日時をクリックして詳細ページを開きます。長文は「さらに表示」で展開します。
4. ブックマークレットを実行すると、アプリの新しいタブに本文が取り込まれ、AIがタグを提案します。
5. 不要なタグをクリックして外し、任意のタグを追加して保存します。
6. 一覧から元のポストを開けます。タグでの絞り込み・タグ別のグループ表示・本文検索・編集・削除に対応します。

ブックマークレットを利用できないブラウザーでは「ポストを追加」からURLと本文を入力できます。右上のボタンでJSONの書き出し・読み込みもできます。

## ローカル起動

Node.js 22以上を使用します。

```powershell
npm install
node scripts/setup-local.mjs
# .env.local の OPENAI_API_KEY を設定
npm run dev
```

`http://127.0.0.1:5173` を開きます。`.env.local` の `APP_ACCESS_TOKEN` がアプリの「AI設定」で入力するアクセスコードです。ローカルAPIの環境変数は起動時に読み込むため、変更後はサーバーを再起動します。

| 環境変数 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI APIキー。サーバー側だけで使用 |
| `OPENAI_MODEL` | モデル名。省略時は `gpt-4.1-mini` |
| `APP_ACCESS_TOKEN` | AI利用を制限するアプリ専用の長いランダムなアクセスコード |

`.env.local` はGitとVercelへのソースアップロードから除外しています。ブラウザーへ環境変数を展開する `VITE_` 接頭辞は付けません。

## Vercelへ公開

フロントエンドはVite、`api/analyze.js` はVercelのNode.js Functionです。

```powershell
npm exec --yes --package=vercel -c "vercel link --yes --project x-bookmark"
npm exec --yes --package=vercel -c "node scripts/vercel-env.mjs"
npm exec --yes --package=vercel -c "vercel deploy --prod --yes"
```

環境変数設定スクリプトは `.env.local` の3変数を本番環境へ登録します。値は標準入力で渡し、ログやコマンド引数に表示しません。Vercelの管理画面から同じ変数を登録しても構いません。変更後は再デプロイが必要です。

ブックマークレットは表示中のアプリのオリジンを使用します。本番用の固定URLで登録してください。デプロイごとのURL・localhost・別のドメインは別の保存領域になります。

## 保存と外部通信

- ブックマークは `localStorage` の `postnote.bookmarks.v1` に保存します。保存するのはポストのURL・本文・投稿者・タグ・リンク先のタイトル等です。ブックマークのサーバーDBはありません。
- 取り込みデータはURLのフラグメントで渡し、読み取り後にアドレスバーから除去します。取り込み途中の下書きはタブ内の `sessionStorage` に保持します。
- AI提案時は本文・本文中のURL・既存タグをアプリのAPIへ送信します。サーバーがリンク先の公開HTMLを取得し、その内容をOpenAIのResponses APIへ送ります。API呼び出しは `store: false` を指定します。OpenAI側のデータ取り扱いは同社のAPIポリシーに従います。
- ブックマークは同じブラウザー・同じオリジンに限って共有されます。端末間の自動同期はありません。ブラウザーデータの削除で失われるため、必要に応じてJSONバックアップを書き出してください。
- 同じポストを再保存すると、最初の保存日時を保ったまま内容とタグを更新します。壊れた保存データを空データとして上書きしません。

## リンク解析と制約

- 本文は最大30,000文字、解析対象は最初の5リンク、1ページあたりHTMLは最大1MB・抽出本文は最大10,000文字です。
- 各リンクは最大8秒・4回までのリダイレクトで取得します。内部IP・localhost・特殊ポート・認証付きURLを拒否し、検証済みの公開IPに接続先を固定します。転送先も再検証します。
- ログイン必須ページ・PDF・JavaScriptで本文を生成するページ・取得拒否されたページは十分に読めない場合があります。取得できなかったリンクは画面に明示し、利用できる本文だけでタグ提案します。
- Xのログイン情報・Cookieは取得せず、ブックマークレットがその時点で表示されている本文を読みます。画像・動画の内容は解析しません。
- XのDOM変更やブラウザーの制限によりブックマークレットが動作しなくなる場合があります。手動入力で保存できます。
- アクセスコードによる認証と、インスタンス内でIPあたり12回/分の簡易制限があります。この回数制限は分散環境全体の課金上限ではありません。利用予算はOpenAIのプロジェクト側でも管理してください。

## 検証

```powershell
npm test
npm run build
node scripts/smoke.mjs http://127.0.0.1:5173 --llm
```

単体・DOMテストはOpenAIの応答を模擬して実行します。`smoke.mjs --llm` は `.env.local` のキーで実際のOpenAI APIにテスト文を送信します。

2026-10-21時点で25件の単体・DOMテスト、本番ビルド、本番URLのHTTP 200、アクセスコード認証、TypeScript公式ページの取得、OpenAI実通信を確認しました。本番では「TypeScript」「公式ドキュメント」「プログラミング学習」「開発」の提案を受け取りました。実ブラウザーでの表示・X上でのブックマークレット実行は、この作業環境でブラウザーを操作できないため未確認です。

公開後に主要機能が動かなくなった場合は、VercelのDeploymentsから直前の正常なデプロイへ戻します。ブラウザーに保存したブックマークはデプロイの切り戻しでは削除されません。

## 参照した公式仕様

- [Vercel上のViteとFunctions](https://vercel.com/docs/frameworks/frontend/vite)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [同一オリジンとWeb Storage](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
