---
title: "Claude CodeでMCPの設定を分けて運用する: 仕事/私用・プロジェクト別の構成例"
emoji: "🔧"
type: "tech"
topics: ["claudecode", "mcp", "dotfiles", "zsh", "cli"]
published: true
publication_name: "lclco"
---

## 最近の困りごと

Claude CodeでMCP（Model Context Protocol）を使い始めると、だいたい次の壁にぶつかります。

- 家のMacと会社のMacで同じ設定を使いたい
- 仕事用と私用でMCPを切り替えたい
- iOSプロジェクトだけで使うMCP、Androidだけで使うMCPがある
- プロジェクトごとに `.mcp.json` を追加するのが面倒
- 不必要なMCPでコンテキストトークンを圧迫したくない

単一端末・単一プロジェクトなら1回だけ設定すればいいだけですが、
環境が増えるほど個別最適化するために細かく設定を分ける手間が増えてきます。

そこで本記事ではユーザーレベルとプロジェクトレベルの設定を用途別に分けて管理する構成を紹介します。個人的にはこれが今のベストプラクティスです。

:::message
今回はClaude Codeを前提に進めますが、他のAI agentでも同様のアプローチが可能だと思いますのでぜひ参考にしてみてください。
:::

## この記事でできるようになること

- MCP設定をファイルに分割して、複数端末で共有しやすくする
- 仕事/私用を 1コマンドで切り替える
- プロジェクト別の `.mcp.json` をセットアップスクリプトで管理する

## 設計の要点

Claude CodeのMCP設定は、次の5点を押さえるだけです。

1. `claude` は **`--mcp-config`** で「どのMCP設定ファイルを使うか」を指定できる
2. 設定ファイルを用途ごとに分割する（例: 私用 / 仕事用）
3. プロジェクト専用のMCPは、共通置き場に置いて **セットアップスクリプト**で管理する
4. 起動コマンドは **エイリアス**で短くする（例: `c` / `cw`）
5. トークンなどの機密情報は、JSONに直書きせず **環境変数**で渡す（`${TOKEN_NAME}`）

## セットアップ手順

### 前提条件

- Claude Codeがインストール済み
- dotfilesで`~/.claude/`を管理できる
- zsh（他のシェルでも同様に設定可能）

### 1) MCP設定の置き場を作る

MCP設定を一箇所に集めます。おすすめは `~/.claude/` 配下。

```text
~/.claude/
├── mcp-private.json   # 私用の「ユーザーレベル設定」
├── mcp-work.json      # 仕事用の「ユーザーレベル設定」
├── bin/
│   └── setup-mcp      # プロジェクト用のセットアップスクリプト
└── mcp/
    ├── ios.mcp.json   # iOS用の「プロジェクトレベル設定」
    ├── android.mcp.json
    └── ...
````

ここでの考え方はシンプルです。

* `mcp-private.json` / `mcp-work.json` は「どのプロジェクトでも使う基本セット」
* `mcp/ios.mcp.json` みたいなのは「特定ジャンル（iOSなど）で使う追加セット」

### 2) 私用/仕事用のMCP設定ファイルを作る

#### 私用（mcp-private.json）の例

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]
    }
  }
}
```

:::message
Serenaは`~/.serena/serena_config.yml`を自動で読み込みます。[グローバル設定](https://oraios.github.io/serena/)を参照してください。
:::

#### 仕事用（mcp-work.json）の例

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]
    },
    "custom-mcp": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

ポイントは、`mcp-work.json` が単体で読み込まれるため、共通分も含めて書くことです。
トークンなどの秘匿情報は `${TOKEN_NAME}` 形式で環境変数に逃がします。

### 3) プロジェクト用のMCPを別ファイルに分ける

例: `~/.claude/mcp/ios.mcp.json`

```json
{
  "mcpServers": {
    "ios-simulator": {
      "command": "npx",
      "args": ["-y", "ios-simulator-mcp"]
    },
    "xcodebuild": {
      "command": "npx",
      "args": ["-y", "@anthropic/xcodebuildmcp"]
    },
    "mobile-mcp": {
      "command": "npx",
      "args": ["-y", "@mobilenext/mobile-mcp@latest"]
    },
    "xcodeproj": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", ".:/workspace", "ghcr.io/giginet/xcodeproj-mcp-server", "/workspace"]
    }
  }
}
```

### 4) プロジェクト側に `.mcp.json` をセットアップする

プロジェクト直下に `.mcp.json` があると、Claude Codeがそのプロジェクト用設定として読みます。

このとき、複数のプロジェクトなどで同じMCPの構成を採用する場合、構成を変更するたびに各プロジェクトのファイルを更新する必要があり面倒です。

`setup-mcp` スクリプトを用意して、セットアップを簡単にします。

```bash
#!/bin/bash
# setup-mcp: プロジェクトにMCP設定をコピー

set -e

MCP_DIR="$HOME/.claude/mcp"
TARGET=".mcp.json"

case "$1" in
  ios)
    cp "$MCP_DIR/ios.mcp.json" "$TARGET"
    echo "Copied: ios.mcp.json -> $TARGET"
    echo "Pulling xcodeproj-mcp-server Docker image..."
    docker pull ghcr.io/giginet/xcodeproj-mcp-server
    ;;
  android)
    cp "$MCP_DIR/android.mcp.json" "$TARGET"
    echo "Copied: android.mcp.json -> $TARGET"
    ;;
  *)
    echo "Usage: setup-mcp <ios|android>"
    exit 1
    ;;
esac
```

これで起きることは単純です。

* そのプロジェクトに `.mcp.json` がコピーされる
* 元ファイル（`~/.claude/mcp/ios.mcp.json`）を更新したら `setup-mcp` を再実行すればOK
* チームで `.mcp.json` をコミットして共有できる

また、セットアップスクリプトを用意することで、依存関係のあるツールのインストールや起動などの準備も同時に実行させられます。

#### PATH設定（.zshenv）

```bash
export PATH="$HOME/.claude/bin:$PATH"
```

これでターミナルを再起動させると `setup-mcp` がどこでも呼べるようになります。

### 5) 起動コマンドを短くする

MCPの設定ファイルを指定すると実行コマンドが長くなるので、エイリアスを用意するのがおすすめです。

```bash
alias c='claude --mcp-config="$HOME/.claude/mcp-private.json"'
alias cw='claude --mcp-config="$HOME/.claude/mcp-work.json"'
```

## 実際の使い方（最短ルート）

```bash
# 私用モード
$ c

# 仕事モード
$ cw

# iOSプロジェクトで “iOS用MCP” を有効化
cd <project>
$ setup-mcp ios

# 仕事用MCP + iOS用MCPで起動
$ cw
```


## まとめ

* MCP設定は `--mcp-config` で外部ファイル化できる。
* 私用/仕事用は、ファイルを分けて1コマンド切り替えにする
* プロジェクト別は `.mcp.json` をセットアップスクリプトで管理する
* トークンは環境変数に逃がす。

ぜひ参考にしてみてください。
