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

そこで本記事では**プラグインマーケットプレイス**を使って、ユーザーレベルとプロジェクトレベルの設定を用途別に分けて管理する構成を紹介します。

:::message
2025年2月更新: `--mcp-config` 方式から**プラグインベース**の管理に移行しました。
:::

## この記事でできるようになること

- MCP設定をプラグインとして分割し、複数端末で共有しやすくする
- 仕事/私用を 1コマンドで切り替える
- プロジェクト別のMCPを `settings.local.json` で管理する

## 設計の要点

Claude Codeのプラグイン機能を使った設計です。

1. **プラグインマーケットプレイス**でMCP設定を管理する（GitHubリポジトリ）
2. `enabledPlugins` で有効化するプラグインを指定
3. `--settings` で設定ファイルを切り替える（私用 / 仕事用）
4. プロジェクト専用のMCPは `settings.local.json` で有効化
5. 起動コマンドは **エイリアス**で短くする（例: `c` / `cw`）

## ディレクトリ構成

### プラグインリポジトリ（GitHub）

```text
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json       # マーケットプレイス定義
└── plugins/
    ├── base-mcp/              # 共通MCP（serena, context7）
    │   ├── .claude-plugin/
    │   │   └── plugin.json
    │   └── .mcp.json
    ├── youtrack-mcp/          # 仕事専用MCP
    │   ├── .claude-plugin/
    │   │   └── plugin.json
    │   ├── .mcp.json
    │   └── commands/
    ├── ios-dev/               # iOS開発用
    │   ├── .claude-plugin/
    │   │   └── plugin.json
    │   ├── .mcp.json
    │   └── skills/
    ├── android-dev/           # Android開発用
    │   ├── .claude-plugin/
    │   │   └── plugin.json
    │   └── .mcp.json
    └── personal-tools/        # 個人用commands/skills
        ├── .claude-plugin/
        │   └── plugin.json
        ├── commands/
        ├── skills/
        └── agents/
```

### dotfiles

```text
~/.claude/
├── settings.json          # 私用設定
└── settings-work.json     # 仕事用設定
```

## セットアップ手順

### 前提条件

- Claude Codeがインストール済み
- [GitHub CLI](https://cli.github.com/)（`gh`）がインストール・認証済み
- dotfilesで`~/.claude/`を管理できる

### 1) プラグインリポジトリを作成する

GitHubにプライベートリポジトリを作成します。

#### マーケットプレイス定義（.claude-plugin/marketplace.json）

```json
{
  "name": "my-plugins",
  "owner": {
    "name": "your-username"
  },
  "metadata": {
    "description": "Personal Claude Code plugins",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    { "name": "base-mcp", "source": "./base-mcp" },
    { "name": "work-mcp", "source": "./work-mcp" },
    { "name": "ios-dev", "source": "./ios-dev" },
    { "name": "android-dev", "source": "./android-dev" },
    { "name": "personal-tools", "source": "./personal-tools" }
  ]
}
```

#### プラグインマニフェスト（plugins/base-mcp/.claude-plugin/plugin.json）

```json
{
  "name": "base-mcp",
  "version": "1.0.0",
  "description": "Base MCP servers"
}
```

#### MCP定義（plugins/base-mcp/.mcp.json）

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"
      }
    }
  }
}
```

### 2) 環境変数を設定する

`~/.zshenv` に追加:

```bash
# プライベートリポジトリのプラグイン取得に必要
export GITHUB_TOKEN=$(gh auth token 2>/dev/null)

# MCP用のAPIキー
export CONTEXT7_API_KEY="your-api-key"
export YOUTRACK_TOKEN="your-token"  # 仕事用
```

### 3) マーケットプレイスを登録してプラグインをインストール

Claude Code内で実行:

```bash
# マーケットプレイス追加（プライベートリポジトリはHTTPS URLを使用）
/plugin marketplace add https://github.com/your-username/claude-plugins.git

# プラグインをインストール
/plugin install base-mcp@my-plugins
/plugin install personal-tools@my-plugins

# 仕事用の場合は追加で
/plugin install work-mcp@my-plugins
```

### 4) settings.json を作成する

#### 私用（~/.claude/settings.json）

```json
{
  "enabledPlugins": {
    "base-mcp@my-plugins": true,
    "personal-tools@my-plugins": true
  }
}
```

#### 仕事用（~/.claude/settings-work.json）

```json
{
  "enabledPlugins": {
    "base-mcp@my-plugins": true,
    "work-mcp@my-plugins": true,
    "personal-tools@my-plugins": true
  }
}
```

### 5) エイリアスを設定する

`~/.zsh/aliases.zsh` または `~/.zshrc` に追加:

```bash
alias c='claude --dangerously-skip-permissions'
alias cw='claude --settings ~/.claude/settings-work.json --dangerously-skip-permissions'
```

### 6) プロジェクト別のMCPを有効化する

iOSプロジェクトの場合、プロジェクト直下に `.claude/settings.local.json` を作成:

```json
{
  "enabledPlugins": {
    "ios-dev@my-plugins": true
  }
}
```

これでそのプロジェクトでClaude Codeを起動すると、自動的にiOS用MCPが有効になります。

## 実際の使い方

```bash
# 私用モード
$ c

# 仕事モード
$ cw

# iOSプロジェクトで起動（settings.local.jsonがあれば自動でiOS用MCPが有効に）
$ cd ~/projects/my-ios-app
$ c
```

## プラグイン更新時の操作

プラグインリポジトリを更新したら:

```bash
# マーケットプレイスを更新
/plugin marketplace update my-plugins

# プラグインを再インストール
/plugin install base-mcp@my-plugins --force
```

## 旧方式（--mcp-config）からの移行

以前の `--mcp-config` 方式を使っていた場合:

1. `mcp-*.json` の内容をプラグインの `.mcp.json` に移動
2. `commands/`, `skills/` をプラグインに移動
3. `setup-mcp` スクリプトは不要（`settings.local.json` に置き換え）
4. エイリアスを `--mcp-config` から `--settings` に変更

## まとめ

* MCP設定は**プラグインマーケットプレイス**でGitHub管理できる
* 私用/仕事用は、`settings.json` を分けて `--settings` で切り替える
* プロジェクト別は `settings.local.json` で有効化
* commands/skills/agentsもプラグインに含められる
* トークンは環境変数に逃がす

ぜひ参考にしてみてください。
