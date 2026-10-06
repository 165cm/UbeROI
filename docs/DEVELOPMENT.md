# 開発の進め方（Claude Code・Codex 共通）

<!-- 前半（ブランチ〜PRとコミット）は、ひな形 165cm/ai-dev-template と共通。後半（テスト・デプロイ）はリポジトリごとに書く -->

## ブランチと worktree

正本は GitHub のこのリポジトリ。`main` が本番。

- **1タスク＝1ブランチ**。Claude は `claude/…`、Codex は `codex/…` から始める
- 手元で並行して作業する時は、AI ごとに別の worktree（別の作業フォルダ）を使う。同じフォルダを2つのAIに触らせない

```
git fetch origin
git worktree add ../<リポジトリ名>-claude -b claude/<タスク名> origin/main
git worktree add ../<リポジトリ名>-codex  -b codex/<タスク名>  origin/main
```

- 始める前に `docs/CURRENT_TASK.md` の「作業中」に、担当（Claude／Codex）・ブランチ・触るファイルを1行書く。表で相手が触っているファイルは編集しない
- 終わったら、その1行を消して「最近終わったこと」に移す

## PR と公開

1. ブランチで作業 → テスト → コミット → push → PR を作る（`.github/pull_request_template.md` に沿って書く）
2. **ユーザーに「PR #N を本番公開してよいですか？」と確認**。OK が出てからマージ（squash）
3. マージ後、作業ブランチは `origin/main` から作り直す
4. 相互レビュー：片方のAIが作ったPRを、もう片方がレビューしてから公開するとよい（考え方のクセが違うので抜けが見つかりやすい）

## コミット

- Conventional Commits（`feat:` `fix:` `docs:` `refactor:` `test:` など）。本文は日本語で「何を・なぜ」
- 秘密の値・個人情報はコミットしない。秘密の値の設定は、ユーザーに手順（コマンド）を渡して本人にやってもらう
- モデル名をコミット・PR・コードに書かない

---

## テスト（このリポジトリ用）

最初に1回だけ `npm ci`（使う部品のインストール）。そのあと：

```
npm run typecheck
```

```
npm test
```

```
npm run build
```

### 通しのテスト（E2E：ブラウザーを自動で動かす）

最初に1回だけ、テスト用のブラウザーを入れる：

```
npx playwright install chromium
```

そのあと：

```
npm run e2e
```

- アプリをビルドして `http://localhost:4173/UbeROI/` で動かし、`e2e/*.e2e.ts` を実行する（日本時間・幅390px）
- `e2e/main-flow.e2e.ts`：初期設定→装備購入→出発→レンタル→帰宅精算→分析→記録訂正→バックアップ→復元（仕様 07 の最低限のE2E。金額は A01・A03）
- `e2e/data-safety.e2e.ts`：再読み込み・オフライン（A21）、CSVの2回取り込み・不正行（A19）、デモと実績の分離（A24）、未対応の版の復元（A20）
- `e2e/accessibility.e2e.ts`：自動チェック axe（明・暗の表示）、幅320/390/1280px、文字200%、キーボードだけの操作、誤りの読み上げ（A23）
- `e2e/cash.e2e.ts`：お釣り計算機
- `e2e/outlook.e2e.ts`：終了までの見通し（オファーの記録から今日のペース・この先の混み具合・休憩して再開のおすすめ・終了予定を覚える・エリアの移動のおすすめ）
- `e2e/offer.e2e.ts`：オファー判定（最初はオフ・設定でオン・手入力で判定と記録・届け先の混み具合・締切・前のショートカットの URL の文字を消す・地名の評価）
- `e2e/quest.e2e.ts`：くり返すクエスト（毎週の平日を登録すると、翌週も今の回で0件から数える・回ごとの件数の調整・毎日なのに1日より長い期間は保存しない）
- `e2e/rental-cap.e2e.ts`：レンタルの上限（上限までの残り・上限の後は追加 0円・乗る長さごとの1時間あたり）
- `e2e/week-board.e2e.ts`：計画の画面（稼働の量・7日の帯・空いている稼げそうな時間・＋で見込み入りの候補枠・帯の四角で編集・混み具合や上限がない時の案内・実績を上限から引く・クエストのための時間を逆算して帯に出し、まとめて候補枠に入れる）
- `e2e/quest-strategy.e2e.ts`：クエスト作戦表（日跨ぎ＋毎日の昼ピーク：本命・最低の日ごとの件数・時間・報酬）
- `e2e/quest-ocr.e2e.ts`：クエストの画面のスクショ（`e2e/fixtures/quest-weekend.png`・合成画像）を文字認識して期間と段階を入れる。外部への通信がないこと・保存済みの名前は読み取り直しても変えない
- `e2e/area-route.e2e.ts`：時間帯ごとのエリア計画（移動の分のエリアがない時の案内・混む時間に合わせて隣のエリアへ移る順番・着く時刻・ずっといる場合との差）
- `e2e/quest-week.e2e.ts`：クエストを軸にした週の組み立て（クエストがなければ出さない・選んだ候補枠で届く件数・次の段階まで足す時間とボーナス込みの純時給・👉 と「＋ 候補枠を足す」・先の週は次の回）
- `e2e/map.e2e.ts`：混み具合の地図（地図のタップでエリアの中心を決める・開くまで地図の画像を読み込まない・混み具合の色の円・つまみと ▶ で時間を動かす。地図の画像は読み込まず透明の画像を返す）
- `e2e/area.e2e.ts`：エリアの混み具合の登録・ホームのこの先4時間の表・計画の見込み・スクショからの読み取り（合成画像）
- `e2e/density.e2e.ts`：ⓘ の説明の開閉と読み上げ、設定済みを1行に畳む動き（`docs/UI_RULES.md`「4. 情報密度」）
- 手元で `npm run preview` などを動かしたままだと、それを使い回して古いビルドで試験してしまう。先に止めておく

- 計算ロジックのテストは `src/domain/domain.test.ts`。値は `docs/spec/fixtures/` と受入基準（`docs/spec/docs/07-acceptance.md`）から取る
- PR を出すと GitHub Actions（`.github/workflows/ci.yml`）が同じ3つと E2E を自動で実行する（E2E が失敗した時は、結果の画面を `playwright-report` として7日間残す）
- 画面を変えた時は、スマホ縦（390×844）・320px幅・横・パソコンで確認する

## 手元で動かす

```
npm run dev
```

表示されたURL（`http://localhost:5173/UbeROI/`）をブラウザで開く。

## デプロイ（このリポジトリ用）

`main` にマージすると GitHub Pages に自動で出る（`.github/workflows/pages.yml`）。公開URL：https://165cm.github.io/UbeROI/

最初の1回だけ、GitHub の Settings → Pages → Build and deployment の Source を「GitHub Actions」にする。

## 変更の時に必ずやること（このリポジトリ用）

- 計算式を変える時は、先に `docs/spec/docs/02-profitability.md` との食い違いがないか確かめ、`src/domain/core.ts` の `CALCULATION_VERSION` を上げる
- 保存データの形を変える時は、データの版（schema_version）を上げて移行処理を書く
- 画面から計算式を書かない。必ず `src/domain/` の関数を使う
- Service Worker は本番ビルドだけで動く（`npm run dev` では登録しない）。版は自動で変わるので手で上げなくてよい
- `public/icon.svg` を変えたら、PNG アイコン（192・512・apple-touch-icon 180）も作り直す
- `docs/spec/` を変えたら `MANIFEST.sha256` を作り直す（`docs/spec` で `sha256sum $(awk '{print $2}' MANIFEST.sha256) > MANIFEST.sha256`）。変えた理由は `docs/CURRENT_TASK.md` の決めごとに書く
