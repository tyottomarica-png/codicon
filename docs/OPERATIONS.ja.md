# Codicon 操作ガイド

Codicon は、Xbox コントローラから手を離さず Codex の指示・モデル・推論量・速度・承認を操作するためのデスクトップアプリです。Linux と macOS で同じ標準 Gamepad マッピングを使用します。

## 最初に行うこと

1. 最新の Codex CLI をインストールし、`codex login` で ChatGPT にサインインします。
2. Xbox コントローラを USB または Bluetooth で接続します。
3. Codicon を起動し、上部中央のワークスペース名から作業対象フォルダを選びます。
4. 画面右上が `CODEX ONLINE`、コントローラ表示が `XBOX READY` になれば準備完了です。

macOS では初回の Push to Talk 時にマイク権限を許可してください。Codicon がマイクを使用するのは Push to Talk 中だけです。

## Power Ring

Power Ring は3種類の値を分けて扱います。

- モデル: Sol / Terra / Luna など。LBを押しながら左スティックの方向で選択します。
- 推論量: Low / Medium / High / Extra High / Max / Ultra。LBを押しながら右スティックの方向で選択します。表示される候補と並びは、選択モデルが Codex から返したものです。
- 速度: RS押し込みで Fast をオン/オフします。内部では選択モデルが公開する service tier ID（現在は `priority`）を使用します。

LBを離すと、左右スティックでプレビューしていたモデルと推論量が同時に確定します。LBを押している最中にBを押すと変更をキャンセルします。選択が変わるたびに対応コントローラでは短いハプティックフィードバックが鳴ります。

Max は1つのエージェントにより長く考えさせる設定です。Ultra は複数エージェントを積極利用する設定です。Fast は速度優先の service tier であり、この2つとは独立しています。

## 音声で指示する

RBを押し続けて話し、話し終えたら離します。マイク入力は24 kHz・モノラル・16-bit PCMに変換され、Codex app-server のリアルタイム音声セッションへ送られます。別の OpenAI API キーは不要です。

音声認識中はチャット欄に認識途中の文が表示されます。RBを離すと残りの文字起こしが Codex に引き渡され、通常のターンとしてツール実行やファイル編集が進みます。

リアルタイム音声は現行 Codex app-server では実験的機能です。接続できない場合は画面下部に理由を表示し、テキスト入力はそのまま利用できます。

## そのほかの既定ボタン

| ボタン | 動作 |
| --- | --- |
| A | テキスト送信、承認ダイアログの「今回のみ許可」、質問の推奨回答 |
| B | 実行中ターンの中断、承認拒否、Power Ringのキャンセル |
| X | テキスト入力欄へフォーカス |
| Y | 新規セッション。以前のセッションはCodex履歴に残ります |
| LB（ホールド） | Power Ring |
| RB（ホールド） | Push to Talk |
| RS（クリック） | Fast 切り替え |
| Menu | 設定パネル |

すべてのボタン割り当てとスティックのデッドゾーンは Settings > Xbox mappings で変更できます。スティックドリフトが強い場合は deadzone を上げてください。コントローラ操作を完全に無効化するスイッチもあります。

## 背景で動かす

Codicon はコントローラ入力を Electron のメインプロセスで SDL 経由で直接読み取ります。ブラウザの Gamepad API と違いフォーカスを必要としないため、**Codex CLI や Claude Code のウィンドウを前面にしたままでも、上記のボタン操作はすべて効きます**。

- ステータスバーに `BG` バッジが出ていれば、背景入力が有効です。
- メニューバー（Linux ではトレイ）のアイコンからウィンドウの表示/非表示、オーバーレイの切り替え、終了ができます。
- ウィンドウを閉じてもセッションは終了せず、常駐状態になります。完全に終了するにはメニューバーの Quit を使ってください。この挙動は Settings > Background operation で変更できます。

### ステータスオーバーレイ

小さなオーバーレイが常に最前面に表示され、現在のモデル・推論量・ターンの状態（WORKING / LISTENING / NEEDS APPROVAL）を示します。フォーカスを奪わないので、他のアプリでの入力を妨げません。ドラッグで移動でき、位置は記憶されます。⤢ ボタンでメインウィンドウを前面に戻せます。

macOS のフルスクリーン領域の上にも表示されます。不要な場合は Settings > Background operation か、メニューバーのチェックボックスから消せます。

### macOS の権限

macOS がコントローラ入力をアプリに渡すために、**システム設定 > プライバシーとセキュリティ > 入力監視** で Codicon を許可する必要がある場合があります。ステータスバーが `INPUT OFFLINE` のまま、またはボタンが背景でだけ効かない場合はここを確認してください。

なお macOS 15.4 には背景でのコントローラ入力が壊れる不具合がありましたが、[Apple により 15.5 で修正済み](https://developer.apple.com/forums/thread/780929)です。15.4 を使っている場合はアップデートしてください。

## 承認と安全設定

既定は `Auto` です。Codex はワークスペース内を読み書きでき、外部ネットワークや範囲外の操作では承認を求めます。

- Read Only: コードを読み取って相談・計画する用途。
- Auto: `workspace-write` + `on-request`。通常利用の推奨値。
- Full Access: サンドボックス制限を外します。信頼できるリポジトリでのみ使用してください。

Full Access は Settings からしか選べず、Power Ring や単一のコントローラ誤入力では有効になりません。コマンド・ファイル変更の承認には、実行内容と理由が表示されます。

## モデルプリセットを変える

Settings > Model presets で、3方向の各枠に `model/list` から返った任意のモデルを割り当てられます。モデル名や推論オプションは固定リストではなく、起動中の Codex CLI から取得します。新しいモデルが追加された場合もアプリ更新なしで候補に現れます。

## 配布物

Linux x64 では次を実行できます。

```bash
chmod +x Codicon-0.1.0-linux-x86_64.AppImage
./Codicon-0.1.0-linux-x86_64.AppImage
```

macOS の DMG/ZIP は macOS 上で `npm run dist:mac` を実行するか、同梱の GitHub Actions workflow から生成します。SDL のネイティブバイナリはインストール時にそのマシンのアーキテクチャ向けに取得されるため、`dist:mac` は**実行したマシンのアーキテクチャ分だけ**を生成します。x64 と arm64 の両方が必要な場合は、workflow が Apple Silicon と Intel のランナーでそれぞれビルドします。第三者へ配布する際は Apple Developer ID 署名と notarization を設定してください。

## トラブルシューティング

- `CODEX OFFLINE`: Settings の Codex CLI path を確認し、ターミナルで `codex doctor` を実行します。macOSのGUI起動ではPATHが短いため、Codiconは `~/.local/bin/codex` と Homebrew の標準パスも検索します。
- `NO GAMEPAD`: OSのゲームコントローラ設定で接続を確認し、一度ボタンを押します。標準マッピングでない機種はボタン番号をSettingsで調整します。
- `INPUT OFFLINE`: SDL のコントローラ読み取りを開始できていません。ステータス表示にカーソルを合わせると理由が出ます。macOS では「入力監視」の許可を確認してください。
- 音声エラー: OSのマイク権限、Codexへのサインイン、ネットワーク接続を確認します。`CODEX_SMOKE_VOICE=1 npm run smoke:codex` で音声セッションとPCM受信だけを確認できます。
- Linuxの開発版が `chrome-sandbox` で停止: ElectronのLinux sandbox手順に従って開発バイナリの所有者・modeを設定します。配布ランチャーに `--no-sandbox` を埋め込まないでください。

Codex連携は公式の [app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) を使用しています。
