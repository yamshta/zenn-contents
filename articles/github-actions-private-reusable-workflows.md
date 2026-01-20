---
title: "GitHub Actions共通化: Private Reusable WorkflowsをTeamプランで運用する実践手法"
emoji: "🔄"
type: "tech"
topics: ["githubactions", "cicd", "devops", "reusableworkflows"]
published: false
---

## 背景

複数のモバイルアプリ（iOS/Android）を開発する組織において、CI/CDワークフローの重複は大きな運用コストとなります。各リポジトリで似たようなワークフローを個別に管理すると、以下の課題が発生します：

- ワークフロー更新時に全リポジトリで同じ変更が必要
- バグ修正やベストプラクティスの横展開が困難
- 新規プロジェクト立ち上げ時のセットアップコスト

GitHub Actionsには共通化の仕組みがありますが、**GitHub Teamプラン**でPrivateリポジトリを使用する場合、特有の制約と回避策を理解する必要があります。本記事では、4つのモバイルリポジトリでワークフロー共通化を実現し、運用コストを削減した実践事例を紹介します。

## 要点

1. **共通化には2つのパターンがある**：
   - **Composite Actions**: ステップの部分的な共通化（小規模な処理の再利用）
   - **Reusable Workflows**: ワークフロー全体の共通化（ジョブ全体の再利用）

2. **Private Reusable Workflowsの認証問題**：
   - scheduled event時に `GITHUB_TOKEN` では Private リポジトリにアクセスできない
   - GitHub App tokenをJob outputs経由で渡すと `secret` として扱われて失敗する

3. **解決策: Workflow内でtoken生成**：
   - Reusable Workflow内でGitHub App tokenを再生成することで、scheduled eventでもPrivateリポジトリへアクセス可能

4. **運用コスト削減の実現**：
   - 6つのワークフローを共通化（自動タグ、リリースノート、Crashlytics処理など）
   - 4リポジトリ × 6ワークフロー = 24ファイルを→ 6ファイルの管理に集約

## 詳細

### 共通化の2つのパターン

GitHub Actionsの共通化には、用途に応じて2つの手法があります。

#### パターン1: Composite Actions（部分的な共通化）

**特徴**：
- アクション内の複数ステップをまとめて再利用
- `action.yml` で定義し、`uses:` で呼び出す
- 軽量で、既存ワークフローに組み込みやすい

**適用例**：PR lintなどの単純なチェック処理

```yaml
# 呼び出し側: .github/workflows/pr-lint.yml
name: PR Lint
on: [pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Composite Actionを使用
      - uses: <ORGANIZATION>/common-actions/pr-lint@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

```yaml
# Composite Action側: common-actions/pr-lint/action.yml
name: 'PR Lint'
description: 'Lint pull request title and commits'

inputs:
  github-token:
    description: 'GitHub token'
    required: true

runs:
  using: 'composite'
  steps:
    - name: Check PR title
      shell: bash
      run: |
        # PR タイトルのチェックロジック
        ...
```

**メリット**：
- 実装がシンプル
- 既存ワークフローへの影響が小さい
- アクション単位で管理できる

**デメリット**：
- ジョブ全体の共通化はできない
- 複雑なワークフローには不向き

#### パターン2: Reusable Workflows（ワークフロー全体の共通化）

**特徴**：
- ワークフロー全体（ジョブ構成含む）を再利用
- `workflow_call` イベントで定義
- scheduled eventやworkflow_dispatchなど、イベントトリガーを呼び出し側で制御

**適用例**：Crashlytics自動修正ワークフロー

```yaml
# 呼び出し側: .github/workflows/crashlytics-auto-fix.yml
name: Crashlytics Auto Fix
on:
  schedule:
    - cron: '0 2 * * 1'  # 毎週月曜 02:00 UTC
  workflow_dispatch:

jobs:
  auto-fix:
    # Reusable Workflowを呼び出す
    uses: <ORGANIZATION>/<SHARED_WORKFLOWS_REPO>/.github/workflows/crashlytics-auto-fix.yml@main
    secrets:
      manager-app-id: ${{ secrets.MANAGER_APP_ID }}
      manager-private-key: ${{ secrets.MANAGER_PRIVATE_KEY }}
      claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
      firebase-service-account: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
```

```yaml
# Reusable Workflow側: <SHARED_WORKFLOWS_REPO>/.github/workflows/crashlytics-auto-fix.yml
name: Reusable Crashlytics Auto Fix

on:
  workflow_call:
    secrets:
      manager-app-id:
        required: true
      manager-private-key:
        required: true
      claude-code-oauth-token:
        required: true
      firebase-service-account:
        required: true

jobs:
  auto-fix:
    runs-on: ubuntu-latest
    steps:
      # ★ ポイント: Workflow内でGitHub App tokenを生成
      - name: Generate GitHub App Token
        id: app-token
        uses: tibdex/github-app-token@v2
        with:
          app_id: ${{ secrets.manager-app-id }}
          private_key: ${{ secrets.manager-private-key }}

      # Private共通リポジトリをcheckout（生成したtokenを使用）
      - name: Checkout shared workflows repo
        uses: actions/checkout@v4
        with:
          repository: <ORGANIZATION>/<SHARED_WORKFLOWS_REPO>
          path: .shared
          token: ${{ steps.app-token.outputs.token }}

      # 以降、Crashlytics処理の実装
      - name: Fetch Crashlytics issues
        run: |
          # Firebase Crashlyticsから最新の問題を取得
          ...

      - name: Auto-fix with Claude Code
        run: |
          # Claude Codeを使用して自動修正
          ...
```

**メリット**：
- ワークフロー全体を一元管理できる
- ジョブの構成、環境変数、条件分岐なども共通化
- 大規模な処理に適している

**デメリット**：
- セットアップがやや複雑
- Privateリポジトリの場合、認証問題が発生する（後述）

### Private Reusable Workflowsの認証問題と解決策

GitHub Teamプランで、Private Reusable Workflowsをscheduled eventで動作させようとすると、以下のエラーが発生します：

```
remote: Repository not found.
fatal: repository 'https://github.com/<ORGANIZATION>/<SHARED_WORKFLOWS_REPO>/' not found
```

#### 問題の原因

1. **scheduled eventでの`GITHUB_TOKEN`制限**：
   - scheduled event時、`GITHUB_TOKEN`の権限が大幅に制限される
   - Private Reusable Workflowsのfetch段階で認証エラーが発生

2. **Job outputsでのsecret制限**：
   - GitHub App tokenを事前生成してJob outputs経由で渡そうとしても失敗
   - GitHub Actionsは secretsをJob outputsとして渡すことを防ぐ
   - ログに「Skip output 'token' since it may contain secret」と警告が出る

#### 解決策の比較

| 解決策 | 実装時間 | Private維持 | scheduled event対応 | セキュリティ | 保守性 |
|--------|----------|-------------|---------------------|--------------|--------|
| **オプション1**: リポジトリをPublic化 | 5分 | ❌ | ✅ | △ | ✅ |
| **オプション2**: Composite Actionsに書き換え | 1-2日 | ✅ | ✅ | ✅ | △ |
| **オプション3**: Workflow内でtoken生成 | 1-2時間 | ✅ | ✅ | ✅ | ✅ |

#### オプション3の実装（推奨）

**実装方針**：
- 呼び出し側から GitHub App token ではなく、`APP_ID` と `PRIVATE_KEY` をsecretsとして渡す
- Reusable Workflow内の**最初のステップ**でtokenを生成
- 生成したtokenで共通リポジトリをcheckout

**実装手順**：

##### 1. Reusable Workflow側の修正

```yaml
# <SHARED_WORKFLOWS_REPO>/.github/workflows/crashlytics-auto-fix.yml
name: Reusable Crashlytics Auto Fix

on:
  workflow_call:
    secrets:
      # GitHub App認証情報を受け取る
      manager-app-id:
        required: true
      manager-private-key:
        required: true
      claude-code-oauth-token:
        required: true
      firebase-service-account:
        required: true

jobs:
  auto-fix:
    runs-on: ubuntu-latest
    steps:
      # ★ 最初のステップでGitHub App tokenを生成
      - name: Generate GitHub App Token
        id: app-token
        uses: tibdex/github-app-token@v2
        with:
          app_id: ${{ secrets.manager-app-id }}
          private_key: ${{ secrets.manager-private-key }}

      # 生成したtokenを使用してPrivateリポジトリをcheckout
      - name: Checkout shared repo
        uses: actions/checkout@v4
        with:
          repository: <ORGANIZATION>/<SHARED_WORKFLOWS_REPO>
          path: .shared
          ref: main
          token: ${{ steps.app-token.outputs.token }}  # ✅ Job内のstepなので使用可能

      # 以降の処理...
      - name: Run auto-fix script
        run: |
          cd .shared/scripts
          ./crashlytics-auto-fix.sh
        env:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
          CLAUDE_TOKEN: ${{ secrets.claude-code-oauth-token }}
          FIREBASE_SA: ${{ secrets.firebase-service-account }}
```

##### 2. 呼び出し側の修正

```yaml
# 各プロジェクトリポジトリ: .github/workflows/crashlytics-auto-fix.yml
name: Crashlytics Auto Fix
on:
  schedule:
    - cron: '0 2 * * 1'
  workflow_dispatch:

jobs:
  auto-fix:
    uses: <ORGANIZATION>/<SHARED_WORKFLOWS_REPO>/.github/workflows/crashlytics-auto-fix.yml@main
    secrets:
      # APP_IDとPRIVATE_KEYを渡す（tokenではない）
      manager-app-id: ${{ secrets.MANAGER_APP_ID }}
      manager-private-key: ${{ secrets.MANAGER_PRIVATE_KEY }}
      claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
      firebase-service-account: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
```

##### 3. Secretsの設定

各プロジェクトリポジトリのSettings > Secrets and variables > Actionsで以下を設定：

```
MANAGER_APP_ID: <GitHub AppのApp ID>
MANAGER_PRIVATE_KEY: <GitHub AppのPrivate Key（PEM形式）>
CLAUDE_CODE_OAUTH_TOKEN: <Claude Code OAuth Token>
FIREBASE_SERVICE_ACCOUNT: <Firebase Service AccountのJSON>
```

**このアプローチのメリット**：

1. **Private repositoryを維持できる**
   - 共通ワークフローリポジトリを公開する必要がない
   - 組織のCI/CDロジックを非公開に保てる

2. **Scheduled eventで確実に動作**
   - Reusable Workflow内でtokenを生成するため、scheduled eventの制限を回避
   - Job outputsの制限も関係ない（同一Job内でtokenを生成・使用）

3. **既存のアーキテクチャを維持**
   - Reusable Workflowsの構造を大きく変える必要がない
   - Composite Actionsへの書き換え不要

4. **セキュリティが高い**
   - Secretsは暗号化されて渡される
   - GitHub App tokenの有効期限は最大24時間（自動的に短命）
   - Private Keyはリポジトリに保存されず、Secretsで管理

**デメリット**：
- ワークフロー実行ごとにtoken生成のオーバーヘッド（数秒、実用上は無視可能）
- `tibdex/github-app-token@v2` への依存が増える

### 共通化の実施結果

4つのモバイルリポジトリ（iOS/Android × 2プロジェクト）で以下のワークフローを共通化：

| ワークフロー名 | 種類 | 説明 |
|---------------|------|------|
| `crashlytics-auto-fix.yml` | Reusable Workflow | Crashlytics問題の自動修正 |
| `crashlytics-summary-slack.yml` | Reusable Workflow | Crashlytics週次サマリーのSlack通知 |
| `generate-release-notes.yml` | Reusable Workflow | リリースノート自動生成（iOS/Android別） |
| `claude-code-review.yml` | Reusable Workflow | Claude CodeによるPRレビュー |
| `pr-lint.yml` | Composite Action | PRタイトルとコミットメッセージのlint |
| `auto-tag-release.yml` | Reusable Workflow | タグとリリースの自動作成 |

**効果**：
- **管理ファイル数**: 24ファイル → 6ファイル（75%削減）
- **更新時の作業**: 4リポジトリ個別対応 → 共通リポジトリのみ更新
- **新規プロジェクト立ち上げ**: 数日 → 数時間（呼び出し側の設定のみ）

## 落とし穴 / アンチパターン

### 1. scheduled eventでGITHUB_TOKENを使う

```yaml
# ❌ Bad: scheduled eventで GITHUB_TOKEN を使用
on:
  schedule:
    - cron: '0 2 * * 1'

jobs:
  auto-fix:
    uses: <ORG>/<SHARED_REPO>/.github/workflows/workflow.yml@main
    secrets:
      github-token: ${{ secrets.GITHUB_TOKEN }}  # ❌ Private repoへのアクセス失敗
```

**問題**: scheduled eventでは`GITHUB_TOKEN`の権限が制限され、Privateリポジトリにアクセスできません。

**解決策**: GitHub App tokenを使用する（オプション3）。

### 2. Job outputsでsecretを渡す

```yaml
# ❌ Bad: 事前生成したtokenをJob outputs経由で渡す
jobs:
  generate-token:
    runs-on: ubuntu-latest
    outputs:
      token: ${{ steps.app-token.outputs.token }}  # ❌ Secretとして扱われ、出力されない
    steps:
      - name: Generate token
        id: app-token
        uses: tibdex/github-app-token@v2
        with:
          app_id: ${{ secrets.APP_ID }}
          private_key: ${{ secrets.PRIVATE_KEY }}

  call-workflow:
    needs: generate-token
    uses: <ORG>/<REPO>/.github/workflows/workflow.yml@main
    secrets:
      github-token: ${{ needs.generate-token.outputs.token }}  # ❌ 空になる
```

**問題**: GitHub ActionsはJob outputsにsecretが含まれることを防ぐため、tokenが出力されません。

**解決策**: Reusable Workflow内でtokenを生成する（オプション3）。

### 3. Composite ActionとReusable Workflowを混同する

```yaml
# ❌ Bad: scheduled eventをComposite Actionで処理しようとする
on:
  schedule:
    - cron: '0 2 * * 1'

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: <ORG>/actions/heavy-processing@main  # ❌ Composite Actionは軽量処理向き
```

**問題**: Composite Actionsはステップの集合であり、ジョブレベルの制御（並列実行、マトリックスビルドなど）には不向きです。

**解決策**: 大規模な処理や複雑なジョブ構成にはReusable Workflowsを使用する。

### 4. Privateリポジトリを安易にPublic化する

```yaml
# ⚠️ 注意: セキュリティリスクを考慮せずPublic化
# ワークフロー内に機密情報（API endpoint、内部ツールのURLなど）が含まれる可能性
```

**問題**: ワークフローに組織固有の情報が含まれる場合、Public化はセキュリティリスクとなります。

**解決策**: オプション3（Workflow内でtoken生成）を使用してPrivateを維持する。

## 判断基準

### いつComposite Actionsを使うべきか

✅ **使うべき状況**：
- 単純なステップの集合（3-5ステップ程度）
- 複数のワークフローで使い回したい処理
- ジョブレベルの制御が不要
- 実装を軽量に保ちたい

**例**：
- PRタイトルのlint
- コード品質チェック（lint、format）
- 通知の送信
- キャッシュの設定

### いつReusable Workflowsを使うべきか

✅ **使うべき状況**：
- 複雑なジョブ構成（複数ジョブ、並列実行、マトリックスビルド）
- scheduled eventやworkflow_dispatchなどのトリガーを使用
- 環境変数、条件分岐、ジョブ間の依存関係が必要
- 大規模な処理（ビルド、デプロイ、自動修正など）

**例**：
- Crashlytics自動修正
- リリースノート生成
- 自動タグ作成
- マルチプラットフォームビルド

### Private維持 vs Public化の判断

| 判断軸 | Privateを維持（オプション3） | Public化（オプション1） |
|--------|----------------------------|----------------------|
| **ワークフローに機密情報** | ✅ 推奨 | ❌ 危険 |
| **組織のCI/CDロジックを非公開** | ✅ 推奨 | △ 判断次第 |
| **即座に解決したい** | △ 1-2時間 | ✅ 5分 |
| **長期的な保守性** | ✅ 高い | ✅ 高い |
| **セキュリティ重視** | ✅ 推奨 | △ ワークフロー次第 |

### GitHub Team vs Enterpriseの違い

- **GitHub Team**: Private Reusable Workflowsは同一Organization内でのみ共有可能
- **GitHub Enterprise**: 複数Organizationをまたいだ共有が可能、Internal可視性も利用可能

本記事で紹介したオプション3は、**GitHub Teamプランでも確実に動作**します。

## 参考文献

- [Reusing workflows - GitHub Docs](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [Creating a composite action - GitHub Docs](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [Automatic token authentication - GitHub Docs](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)
- [Events that trigger workflows - GitHub Docs](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)
- [tibdex/github-app-token - GitHub](https://github.com/tibdex/github-app-token)
- [GitHub Apps authentication - GitHub Docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app)
