---
title: "MacBook移行時に役立つ、全Gitリポジトリの未管理ファイルを横断で洗い出すスクリプト"
emoji: "🔍"
type: "tech"
topics: ["git", "bash", "shell", "mac", "dotfiles"]
published: true
publication_name: "lclco"
---

MacBookを新しい環境に移行するとき、こんな不安を感じたことはありませんか？

- 「`.env`ファイル、ちゃんとバックアップしたっけ...」
- 「このプロジェクトの設定ファイル、Git管理されてないかも」
- 「移行後に動かなくなったら原因特定が大変そう」

そんな時に役立つ、複数のGitリポジトリで`.gitignore`されているファイルを一括で洗い出すスクリプトを作成しました。

## この記事で得られること

- 複数リポジトリを横断して未管理ファイルを洗い出す方法
- `.git`を直接探す方法の落とし穴と正しいアプローチ
- ノイズを除外して「本当に確認すべきファイル」だけを抽出するテクニック
- すぐに使えるシェルスクリプト

## やりたかったこと

ローカルの開発用ディレクトリ配下に、こんな構成があります。

```text
~/dev/
├── github.com/
│   ├── foo/
│   ├── bar/
│   └── baz/
├── dotfiles/
└── misc/
```

それぞれが**独立したGitリポジトリ**です。
全リポジトリを横断して、

- untracked
- ignored
- `.gitignore` から漏れている不要ファイル

を一気に洗い出したいと考えました。

## 素朴なアプローチが壊れる理由

最初に思いつくのはこれです。

```bash
find ~/dev -name .git -type d
```

そして `.git` の親ディレクトリで `git ls-files` を回す方法です。

**しかし、これは壊れます。**

理由は以下の通りです。

- SwiftPM / Xcode / npm / Gradle などが**生成物配下に `.git` を持ち込む**
- `.git` がディレクトリではなく**ファイル（worktree / submodule）** の場合がある
- 同じリポジトリを何十回も踏んでしまう
- `cd` 失敗時にカレントディレクトリが壊れて、意味不明な結果を垂れ流す

結果として「一見動くが、信用できないスクリプト」になってしまいます。

## 正解の考え方

ポイントは **`.git` を探さず、Gitに聞く** ことです。

Git管理下であれば、どのディレクトリからでもこのコマンドが使えます。

```bash
git rev-parse --show-toplevel
```

これで**必ずそのリポジトリのルート**が取れます。
submodule / worktree / file .git すべて回避できます。

## 安全にリポジトリ一覧を確定する

```bash
SEARCH_ROOT="$HOME/dev"  # 任意のディレクトリを指定

find "$SEARCH_ROOT" -type d -maxdepth 6 2>/dev/null \
| while IFS= read -r d; do
    git -C "$d" rev-parse --show-toplevel 2>/dev/null || true
  done \
| sort -u
```

- Git管理外のディレクトリは黙って捨てられます
- 同一リポジトリは `sort -u` で重複排除されます
- `maxdepth` はディレクトリ構造に合わせて調整してください

## 「見る価値のないノイズ」は最初から捨てる

目的は**一覧を眺めることではありません**。
`.gitignore` が未整備なリポジトリを炙り出すことです。

そのため、以下は**最初から除外**します。

- 言語系生成物
  `node_modules`, `vendor/bundle`, `.bundle`
- ビルド成果物
  `build`, `dist`, `out`, `target`, `DerivedData`, `.build`
- IDE / パッケージキャッシュ
  `SourcePackages`, `checkouts`, `.gradle`, `.cache`, `.next`
- ログ
  `log`, `logs`
- OS / 個人設定
  `.DS_Store`, `.idea`, `.vscode`, `.claude`

## 実用スクリプト（macOS / bash）

```bash
set -eEo pipefail

SEARCH_ROOT="$HOME/dev"  # 任意のディレクトリを指定
EXCLUDE_RE='(^|/)(node_modules|vendor/bundle|\.bundle|build|dist|out|target|DerivedData|\.build|SourcePackages|checkouts|\.gradle|\.cache|\.turbo|\.next|\.DS_Store|\.idea|\.vscode|\.claude|log|logs)(/|$)'

find "$SEARCH_ROOT" -type d -maxdepth 6 2>/dev/null \
| while IFS= read -r d; do
    git -C "$d" rev-parse --show-toplevel 2>/dev/null || true
  done \
| sort -u \
| while IFS= read -r repo; do
    git -C "$repo" ls-files --other --ignored --exclude-standard \
    | sed "s|^|$repo/|" \
    | grep -Ev "$EXCLUDE_RE" || true
  done
```

zshの場合、`set -u` はプロンプト関数と衝突しやすいので注意してください。

## ここまで削って残るものは「本物」

この状態で残るのはだいたい以下のようなファイルです。

- `tmp/`
- `coverage/`
- `.env.local`
- エディタの一時ファイル

**これらが移行時に確認すべきファイル** です。

## ゴールを間違えない

このスクリプトのゴールは：

- ❌ 一覧を眺めて満足する
- ⭕ Git管理外のファイルを特定し、新しい環境へ適切に移行する

洗い出したファイルを確認して、必要なものは手動でバックアップ・移行します。`.env`や認証情報など、Git管理できないけれど必要なファイルを見落とさないことが重要です。

## まとめ

- Git リポジトリを跨ぐなら「`.git` を探す」のはやめましょう
- `git rev-parse --show-toplevel` が最も信頼できます
- ノイズは場当たり的に足さず、**集合で定義して捨てましょう**
- 最後に残るものだけが、直す価値のある問題です

MacBook移行時に限らず、定期的に実行することで`.gitignore`の整備漏れを早期発見できます。ぜひ試してみてください。
