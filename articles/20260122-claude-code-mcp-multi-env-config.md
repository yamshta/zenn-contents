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
- プロジェクトごとに設定ファイルを追加するのが面倒
- 不必要なMCPでコンテキストトークンを圧迫したくない

単一端末・単一プロジェクトなら1回だけ設定すればいいだけですが、
環境が増えるほど個別最適化するために細かく設定を分ける手間が増えてきます。

そこで本記事では**プラグインマーケットプレイス**と**複数のsettingsファイル**を使って、環境×プラットフォームの組み合わせをエイリアス1つで切り替える構成を紹介します。

:::message
2026年2月更新: `--mcp-config` 方式から**プラグインベース**の管理に移行しました。
:::

## この記事でできるようになること

- MCP設定をプラグインとして分割し、複数端末で共有しやすくする
- 仕事/私用 × iOS/Android をエイリアス1つで切り替える
- プロジェクトごとの設定ファイル追加が不要

## 設計の要点

1. **プラグインマーケットプレイス**でMCP設定を管理する（GitHubリポジトリ）
2. 環境×プラットフォームの組み合わせごとに `settings-*.json` を用意
3. 起動コマンドは**エイリアス**で切り替える（`c`, `c-ios`, `cw`, `cw-ios` など）

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
    ├── work-mcp/              # 仕事専用MCP
    │   ├── .claude-plugin/
    │   │   └── plugin.json
    │   └── .mcp.json
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
├── settings.json              # 私用
├── settings-ios.json          # 私用 + iOS
├── settings-android.json      # 私用 + Android
├── settings-work.json         # 仕事用
├── settings-work-ios.json     # 仕事用 + iOS
└── settings-work-android.json # 仕事用 + Android
```

## セットアップ手順

### 前提条件

- Claude Codeがインストール済み
- [GitHub CLI](https://cli.github.com/)（`gh`）がインストール・認証済み
- dotfilesで`~/.claude/`を管理できる

### 1) プラグインリポジトリを作成する

GitHubにリポジトリを作成します。パブリックでもプライベートでも構いません。

#### マーケットプレイス定義（.claude-plugin/marketplace.json）

```json
{
  "name": "my-plugins",
  "owner": {
    "name": "your-username"
  },
  "metadata": {
    "description": "Personal Claude Code plugins"
  },
  "plugins": [
    { "name": "base-mcp", "source": "./plugins/base-mcp" },
    { "name": "work-mcp", "source": "./plugins/work-mcp" },
    { "name": "ios-dev", "source": "./plugins/ios-dev" },
    { "name": "android-dev", "source": "./plugins/android-dev" },
    { "name": "personal-tools", "source": "./plugins/personal-tools" }
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

シークレットは `~/.config/secrets/env` で管理し、`~/.zshenv` から読み込みます:

```bash
# ~/.config/secrets/env (git管理外)
export CONTEXT7_API_KEY="your-api-key"
export YOUTRACK_TOKEN="your-token"  # 仕事用MCPで使用
```

```bash
# ~/.zshenv に追加
[ -f ~/.config/secrets/env ] && source ~/.config/secrets/env
```

:::details プライベートリポジトリを使う場合
プライベートリポジトリの場合は `GITHUB_TOKEN` が必要です。`~/.zshenv` に追加:

```bash
export GITHUB_TOKEN=$(gh auth token 2>/dev/null)
```

また、マーケットプレイス追加時はHTTPS URLを使用します:

```bash
/plugin marketplace add https://github.com/your-username/claude-plugins.git
```
:::

### 3) マーケットプレイスを登録してプラグインをインストール

Claude Code内で実行:

```bash
# マーケットプレイス追加
/plugin marketplace add your-username/claude-plugins

# 全プラグインをインストール
/plugin install base-mcp@my-plugins
/plugin install work-mcp@my-plugins
/plugin install ios-dev@my-plugins
/plugin install android-dev@my-plugins
/plugin install personal-tools@my-plugins
```

### 4) settings.json を作成する

環境×プラットフォームの組み合わせごとにファイルを作成します。

#### 私用（~/.claude/settings.json）

```json
{
  "extraKnownMarketplaces": {
    "my-plugins": {
      "source": { "source": "github", "repo": "your-username/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "base-mcp@my-plugins": true,
    "personal-tools@my-plugins": true
  }
}
```

:::message
`extraKnownMarketplaces` を設定しておくと、新しいマシンで `/plugin marketplace add` を実行しなくてもマーケットプレイスが自動認識されます。プラグインのインストールを促されるだけで済むので、セットアップが楽になります。
:::

#### 私用 + iOS（~/.claude/settings-ios.json）

```json
{
  "enabledPlugins": {
    "base-mcp@my-plugins": true,
    "ios-dev@my-plugins": true,
    "personal-tools@my-plugins": true
  }
}
```

#### 私用 + Android（~/.claude/settings-android.json）

```json
{
  "enabledPlugins": {
    "base-mcp@my-plugins": true,
    "android-dev@my-plugins": true,
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

#### 仕事用 + iOS（~/.claude/settings-work-ios.json）

```json
{
  "enabledPlugins": {
    "base-mcp@my-plugins": true,
    "work-mcp@my-plugins": true,
    "ios-dev@my-plugins": true,
    "personal-tools@my-plugins": true
  }
}
```

#### 仕事用 + Android（~/.claude/settings-work-android.json）

```json
{
  "enabledPlugins": {
    "base-mcp@my-plugins": true,
    "work-mcp@my-plugins": true,
    "android-dev@my-plugins": true,
    "personal-tools@my-plugins": true
  }
}
```

### 5) エイリアスを設定する

`~/.zshrc` または `~/.zsh/aliases.zsh` に追加:

```bash
alias c='claude'
alias c-ios='claude --settings ~/.claude/settings-ios.json'
alias c-android='claude --settings ~/.claude/settings-android.json'
alias cw='claude --settings ~/.claude/settings-work.json'
alias cw-ios='claude --settings ~/.claude/settings-work-ios.json'
alias cw-android='claude --settings ~/.claude/settings-work-android.json'
```

## 実際の使い方

```bash
# 私用モード
$ c

# 私用 + iOS開発
$ c-ios

# 私用 + Android開発
$ c-android

# 仕事モード
$ cw

# 仕事 + iOS開発
$ cw-ios

# 仕事 + Android開発
$ cw-android
```

プロジェクトごとの設定ファイルは不要です。起動時にエイリアスを選ぶだけで環境が決まります。

## プラグイン更新時の操作

プラグインリポジトリを更新したら:

```bash
# マーケットプレイスを更新
/plugin marketplace update my-plugins

# プラグインを再インストール
/plugin install base-mcp@my-plugins --force
```

## この構成のトレードオフ

**メリット:**
- 起動時にエイリアス1つで環境が決まる
- プロジェクトごとの設定不要
- 何が有効かが明確

**デメリット:**
- settingsファイルの重複（共通プラグイン追加時に全ファイル更新）
- 組み合わせが増えると指数的にファイルが増加

現時点（2026年2月）ではClaude Codeがプラグイン依存関係をサポートしていないため、この方式がベストプラクティスです。将来的にプラグイン依存関係がサポートされれば、プリセット方式でより簡潔に管理できるようになるかもしれません。

## 旧方式（--mcp-config）からの移行

以前の `--mcp-config` 方式を使っていた場合:

1. `mcp-*.json` の内容をプラグインの `.mcp.json` に移動
2. `commands/`, `skills/` をプラグインに移動
3. エイリアスを `--mcp-config` から `--settings` に変更

## まとめ

* MCP設定は**プラグインマーケットプレイス**でGitHub管理できる
* 環境×プラットフォームの組み合わせは `settings-*.json` で定義
* エイリアスで起動時に切り替え（`c`, `c-ios`, `cw`, `cw-ios` など）
* commands/skills/agentsもプラグインに含められる
* トークンは環境変数に逃がす

ぜひ参考にしてみてください。
