# 03 データモデル

## 版15：複数サービス精算（2026-10-08）
SessionRecordの既存platform/baseYen/tipsYen/completedCount/adjustmentsは先頭サービスとして維持する。追加サービスは任意のadditionalServices配列で保持し、各要素はplatform、baseYen、tipsYen、bonusYen、adjustmentYen、completedCount。金額・件数は整数またはnull。adjustmentYenのみ負値を許す。同じサービスを重複登録できない。
既存版1〜14はadditionalServices未定義のまま単一サービスとして読み込む。IndexedDBの表・インデックスは変更しない。バックアップは版15で書き出し、復元時に追加分も形・値・重複・確定条件を検証する。分析CSVは1稼働1行を保ち、サービス別の基本報酬・チップ・ボーナス・調整・件数を追加列で出力する。独自CSV v1の取り込みは引き続き単一サービス。
## 共通規約
IDはUUID、金額は整数円、割合は0〜10000のbasis points、日時はISO 8601 UTC、local_dateはAsia/Tokyo。created_at/updated_at/revisionを持つ。外部由来にはsource、observed_at、import_batch_idを付ける。全データにschema_versionを付けて移行する。以下の?はnullable。列挙型以外の未知値を黙って補完しない。

## エンティティ
|エンティティ|主なフィールド（型）|関係・制約|
|---|---|---|
|Settings|id, timezone:string, origin_label:string, origin_lat/lon?:number, target_hourly_yen:int, weekly_budget_minutes:int, home_deadline?:HH:mm, default_tariff_id:UUID|単一ユーザー。緯度経度は任意。目標>=0|
|Session|id, status:draft/active/completed, departed_at:datetime, returned_at?:datetime, area_label:string, revenue_mode:summary/detail, base_yen?:int, tips_yen?:int, completed_count?:int, note?:string|帰宅>出発。completedは帰宅必須。稼働中は1件まで。合計時間が重なる他セッションは保存エラー|
|OnlineInterval|id, session_id, start_at, end_at|Session 1:N。セッション時間内。重複区間は和集合で計算|
|Delivery|id, session_id, external_id?:string, accepted_at?, shop_arrived_at?, picked_up_at?, completed_at?, status:completed/cancelled, base_yen:int, tip_yen:int, estimated_minutes?:int, pickup_area?, dropoff_area?, merchant_label?|詳細入力用。時刻入力時は順序検証。住所・氏名・電話番号は保存しない。キャンセル報酬は調整へ|
|RevenueAdjustment|id, session_id, kind:quest/other, amount_yen:signed int, external_id?, quest_id?, confirmed_at|summary/detailどちらにも別途1回加算。基礎売上に含めない|
|TariffVersion|id, region, vehicle_type, effective_from, initial_minutes:int, initial_yen:int, step_minutes:int, step_yen:int, cap_minutes:int, cap_yen:int, source_url, verified_at|変更は新バージョンを作る。既存データを上書きしない|
|Rental|id, session_id, start_at, end_at?, tariff_snapshot:object, billed_yen?:int, pickup_station_id?, return_station_id?, battery_percent?:int|Session 1:N。見積は派生値。end>=start。請求0円も有効|
|Expense|id, session_id?, paid_at, amount_yen:int, category:communication/insurance/repair/consumable/other, allocation_month?:YYYY-MM, scope:direct/monthly, memo?|directはsession必須。monthlyはsessionなし、対象月必須。資産購入をここへ重複登録しない|
|EquipmentPlan|id, name, tier:beginner/intermediate/advanced/custom, active:boolean|代替プラン。比較中のプランは実績へ影響しない|
|EquipmentPlanItem|id, plan_id, category, label, unit_yen?:int, quantity:int, business_ratio_bps:int, lifetime_months:int, residual_yen:int|価格nullは未設定、0は無料。数量>=1、月数>=1|
|Asset|id, source_plan_item_id?, label, status:owned/purchased, purchased_at?, in_service_month, unit_yen:int, quantity:int, business_ratio_bps:int, management_value_yen:int, residual_yen:int, lifetime_months:int, sold_at?, business_sale_yen?:int|予定品はAssetにしない。購入済みは購入日必須。売却後翌月以降の配賦を停止し残未配賦額は売却月の管理損益調整として処理|
|AvailabilitySlot|id, starts_at, ends_at, return_deadline, area_label, scenario_inputs:object|拘束時間を含む枠。重複枠は同時採用不可|
|Quest|id, start_at, end_at, eligible_rules:object, reward_mode:cumulative/incremental, tiers:array|P2。実績計上はRevenueAdjustmentのみ|
|Station|provider_id:string, name, lat, lon, vehicle_types:array|P2、GBFS由来ID。名前で同定しない|
|StationSnapshot|station_id, observed_at, fetched_at, bikes_available?:int, docks_available?:int, is_renting?:bool, is_returning?:bool, ttl_seconds:int|P2。欠損はnull。過去の空きを現在値と扱わない|
|ContextSnapshot|id, session_id?, slot_id?, observed_at, weather_code?, temperature?, precipitation?, source|P2。天気予報と観測はtypeで区別|
|Prediction|id, slot_id?, generated_at, model_version, inputs_hash, lower_yen?, median_yen?, upper_yen?, sample_size:int, confidence:low/medium/high, reasons:array|実績テーブルへ書き込まない|
|ImportBatch|id, checksum, schema_version, imported_at, counts:object|同じchecksum再取込は拒否/無操作|

## データ整合性
- JSONの未知必須バージョンはインポート拒否。整数安全範囲を超える入力を拒否。
- Session削除は子レコードも同一トランザクションで削除。共有Tariff/Assetは削除しない。
- AssetとEquipmentPlanItemを分離し、プラン変更が購入履歴を変えないようにする。
- 実績集計はcompletedのみ。active/draftはホーム上の暫定欄だけに出す。
- 派生指標は原則保存しない。保存する場合はcalculation_versionと入力hashで無効化。
- インデックス: Session(returned_at), Delivery(session_id), Expense(allocation_month), Rental(session_id), Asset(in_service_month), StationSnapshot(station_id,observed_at)。
- 設定の働ける時間（版11）: settings.availability＝曜日（0＝日〜6＝土）ごとの時間帯 {start, end}（HH:mm・1日3つまで）の配列。null／未定義は制限なし。版10までのバックアップは制限なしとして復元する。
- 天気の手直し（版12）: settings.weatherOverrides＝日付（YYYY-MM-DD・4時区切り）→ clear/cloudy/rain/storm。未定義は予報のまま。版11までのバックアップはそのまま復元する。
- 1日の最長（版13）: settings.maxDayHours＝整数（2〜16時間）。未定義は10時間。版12までのバックアップはそのまま復元する。
- リーダーボード（版14）: quests[].leaderboard＝{ snapshots: [{ at, myRank: 整数≥1|null, myCount: 整数≥0|null, rows: [{ rank: 整数1〜999（重複なし）, count: 整数≥0 }] }]（20個まで）, prizes: [{ upToRank: 整数≥1, rewardYen: 整数≥0 }], targetRank: 整数≥1|null }。他の人の名前・顔写真は持たない。未定義は使わない。版13までのバックアップはそのまま復元する。
- バックアップ形式: {schema_version, exported_at, app_version, datasets:{settings:[],sessions:[],...}}。復元は全体置換のみをMVPとし、マージを実装しない。

## CSV v1（独自形式）
1行1確定セッション。UTF-8、ヘッダーあり、金額はカンマなし、日時はoffset必須。
必須列: external_id, departed_at, returned_at, online_minutes, completed_count, base_yen, tips_yen, bonus_yen, rental_yen, direct_expense_yen, area_label。
オンライン分数は0〜拘束分数、円と件数は非負整数。集計CSVなのでオンライン区間は出発時刻を基準にした集計値として別のsummary_online_secondsフィールドへ保持し、実測区間とは区別する。実測区間を追加した場合は置換を明示確認。
external_idは取込元と組み合わせて一意。同じIDで内容が異なる行は競合表示、黙って上書きしない。CSVではレンタル時刻を推測せずactual-onlyの集計レンタル記録とする。追加字段: Rental.entry_mode=timed/actual_only、actual_onlyではstart/endをnull可、billed_yen必須。
出力時は文字列の先頭が=,+,-,@なら表計算の数式として実行されないようエスケープ。金額型の負数調整とは区別する。
