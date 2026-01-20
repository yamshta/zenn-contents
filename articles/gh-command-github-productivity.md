---
title: "gh コマンドで実現するGitHub組織の生産性可視化システム"
emoji: "📊"
type: "tech"
topics: ["github", "ghcli", "devops", "productivity", "githubactions"]
published: false
publication_name: "lclco"
---

## 背景

開発組織のパフォーマンスを定量的に把握することは、継続的な改善の第一歩です。しかし、複数のリポジトリにまたがる開発活動を手作業で集計するのは非効率的です。本記事では、**GitHub CLI（`gh`コマンド）とYouTrack APIを活用**して、組織の開発生産性を自動的に可視化するシステムの設計と実装を紹介します。

本システムでは、以下の指標を日別・ユーザー別に集計し、開発効率の傾向を分析します：

- **コミット数**: 開発活動量の指標
- **PRマージ数**: 成果物のリリース頻度
- **YouTrackイシュー情報**: タスクの起案者や目的の分析

## 要点

1. **技術選定の判断基準**：
   - **データストレージ**: Firestoreではなくファイル（JSON）ベース → インフラコスト削減、運用保守最小化
   - **GitHub API利用**: Octokitではなく`gh`コマンド → シンプル、デバッグ容易、GitHub Actions標準装備

2. **指標の解釈パターン**：
   - PRマージ数・コミット数が右肩上がり → パフォーマンス向上
   - PRマージ数だけ増加 → AI活用/PR分割が進み効率化
   - コミット数だけ増加 → マージのボトルネック（レビュー待ち、仕様調整）
   - 両方減少 → 阻害要因の可能性

3. **運用保守を最小化する設計**：
   - GitHub Actions自動実行（追加インフラ不要）
   - 月別JSONファイル（1.7MB/月程度、Git管理可能）
   - 設定ファイルのみでリポジトリ分類を管理

4. **ローカルからGitHub Actionsへの段階的移行**：
   - まずローカルで手動実行して成果物を確認
   - 検証後にGitHub Actionsで自動化

## 詳細

### システムの全体像

```
[GitHub Organization]
         |
         | gh コマンドでデータ取得
         v
[データ収集スクリプト]
         |
         | 月別JSON保存
         v
    [data/raw/]
         |
         | 集計処理
         v
  [reports/YYYY-MM/]
    ├── index.html
    └── summary.md
```

### 技術選定の判断プロセス

開発組織の生産性可視化システムでは、以下の技術選択が重要です。

#### データストレージ: Firestore vs ファイルベース

**Firestoreのメリット**:
- 複雑なクエリが簡単
- スケーラビリティが高い
- リアルタイム更新

**ファイルベース（JSON/YAML）のメリット**:
- Firebase設定・認証が不要 → 運用保守が最小限
- データがGit管理できる → 履歴追跡・バックアップ自動
- **インフラコストゼロ**
- よりシンプルな実装

**データ量の試算**:

仮に組織で以下の規模を想定：
- 開発者数: 10人
- 対象リポジトリ: 20個
- 1日の平均コミット数: 50コミット
- 1日の平均PRマージ数: 10件

1ヶ月（30日）のデータ量:
- コミット: 1,500件 × 約0.5KB = 750KB
- PRマージ: 300件 × 約1KB = 300KB
- YouTrackイシュー: 300件 × 約2KB = 600KB
- **合計: 約1.7MB/月**

**結論**: 運用保守を最小限にしたい要件を考えると、**ファイルベース（JSON）が適している**。

**推奨構成**:

```
data/
├── raw/
│   ├── 2026-01.json              # 1月分の全データ
│   ├── 2026-02.json
│   └── 2026-03.json
├── reports/
│   ├── 2026-01/
│   │   ├── index.html            # 月次レポート
│   │   └── summary.md
│   └── 2026-02/
└── config/
    └── repositories.yml          # リポジトリ分類設定
```

#### GitHub API利用: gh コマンド vs Octokit vs GitHub MCP

**3つのアプローチ比較**:

| 項目 | gh コマンド | Octokit | GitHub MCP |
|------|-------------|---------|------------|
| **実装の簡単さ** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **デバッグ容易さ** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **GitHub Actions対応** | ⭐⭐⭐⭐⭐ 標準装備 | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **認証設定** | ⭐⭐⭐⭐⭐ `GITHUB_TOKEN`のみ | ⭐⭐⭐ | ⭐⭐⭐ |
| **プログラマティック制御** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **型安全性** | ❌ | ⭐⭐⭐⭐⭐ TypeScript | ⭐⭐⭐⭐ |
| **並列処理制御** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **利用可能性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ 将来的 |

**gh コマンドの実装例**:

```bash
# リポジトリ一覧取得
gh repo list <ORGANIZATION> --json name,owner,isArchived --limit 100

# PRの取得
gh pr list --repo <ORGANIZATION>/<REPO> --state merged --json number,title,mergedAt

# コミット取得
gh api repos/<ORGANIZATION>/<REPO>/commits --paginate
```

```typescript
// TypeScriptから実行
import { execSync } from 'child_process';

function getOrgRepos(org: string): any[] {
  const output = execSync(
    `gh repo list ${org} --json name,isArchived --limit 1000`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(output);
}
```

**Octokitの実装例**:

```typescript
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const repos = await octokit.repos.listForOrg({ org: '<ORGANIZATION>' });
```

**結論**: **gh コマンドを推奨**。

**理由**:
1. **運用保守が最小限**: GitHub Actionsに標準インストール済み、追加の依存関係不要
2. **デバッグが容易**: コマンドラインで直接実行して動作確認可能
3. **実装がシンプル**: `child_process.execSync`で呼び出すだけ
4. **エラー時の切り替えが容易**: 必要に応じて後からOctokitに切り替え可能

**推奨実装方針**:
- Phase 1: `gh`コマンドで実装（シンプル・高速）
- Phase 2（必要に応じて）: 細かい制御が必要になったらOctokitに切り替え

### 指標の解釈パターン

コミット数とPRマージ数を組み合わせることで、開発活動の質的な傾向を把握できます。

| コミット数 | PRマージ数 | 解釈 | 示唆するアクション |
|-----------|-----------|------|-------------------|
| ↗️ | ↗️ | パフォーマンス向上 | 現状維持、ベストプラクティスの共有 |
| → | ↗️ | AI活用/PR分割の進展 | 効率化の取り組みが成功、他チームへ展開 |
| ↗️ | → | マージのボトルネック | レビュー体制の見直し、仕様調整プロセスの改善 |
| ↘️ | ↘️ | 阻害要因の存在 | 1on1でヒアリング、環境改善 |

**可視化例（イメージ）**:

```
コミット数推移（ユーザーA）
 50|                     ●
 40|              ●
 30|       ●
 20| ●
   |___________________
    W1  W2  W3  W4

PRマージ数推移（ユーザーA）
 10|                     ●
  8|              ●
  6|       ●
  4| ●
   |___________________
    W1  W2  W3  W4

→ 両方が右肩上がり：パフォーマンス向上傾向
```

### 実装アーキテクチャ

#### データ収集スクリプト (`src/collect.ts`)

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface Config {
  organization: string;
  repositories: {
    [category: string]: string[];
  };
  youtrack: {
    url: string;
    token: string;
    projects: string[];
  };
}

async function collectData(config: Config, targetMonth: string) {
  const data = {
    commits: [],
    prs: [],
    youtrackIssues: []
  };

  // リポジトリごとにデータ収集
  for (const [category, repos] of Object.entries(config.repositories)) {
    for (const repo of repos) {
      console.log(`Collecting data from ${config.organization}/${repo}...`);

      // コミット取得（gh コマンド）
      const commitsJson = execSync(
        `gh api repos/${config.organization}/${repo}/commits --paginate --jq '.[] | {sha, commit: {author, message, committer}, author: {login}}'`,
        { encoding: 'utf-8' }
      );

      // PRマージ取得（gh コマンド）
      const prsJson = execSync(
        `gh pr list --repo ${config.organization}/${repo} --state merged --json number,title,mergedAt,author,mergeCommit`,
        { encoding: 'utf-8' }
      );

      data.commits.push(...JSON.parse(commitsJson));
      data.prs.push(...JSON.parse(prsJson));

      // PRタイトルからYouTrack issue番号を抽出
      const prs = JSON.parse(prsJson);
      for (const pr of prs) {
        const issueMatch = pr.title.match(/^([A-Z_]+)-(\d+)/);
        if (issueMatch) {
          const issueId = `${issueMatch[1]}-${issueMatch[2]}`;
          // YouTrack APIでissue詳細を取得（割愛）
          // data.youtrackIssues.push(...);
        }
      }
    }
  }

  // 月別JSONファイルとして保存
  const outputPath = path.join(__dirname, `../data/raw/${targetMonth}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`Data saved to ${outputPath}`);
}
```

#### 設定ファイル (`config/repositories.yml`)

```yaml
organization: <ORGANIZATION_NAME>

repositories:
  # カテゴリ1: プロジェクトA
  project-a:
    - repo1
    - repo2
    - repo3

  # カテゴリ2: プロジェクトB
  project-b:
    - repo4
    - repo5

youtrack:
  url: https://<YOUR_DOMAIN>.myjetbrains.com/youtrack
  token: ${{ secrets.YOUTRACK_TOKEN }}
  projects:
    - PROJECT_A
    - PROJECT_B
```

#### GitHub Actions自動実行 (`.github/workflows/collect-metrics.yml`)

```yaml
name: Collect Productivity Metrics

on:
  schedule:
    # 毎日午前2時（UTC）に実行
    - cron: '0 2 * * *'
  workflow_dispatch:  # 手動実行も可能

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Collect metrics
        run: npm run collect -- --month $(date +%Y-%m)
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          YOUTRACK_TOKEN: ${{ secrets.YOUTRACK_TOKEN }}

      - name: Commit and push data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          git commit -m "chore: update metrics data for $(date +%Y-%m)" || echo "No changes"
          git push
```

### レポート生成

#### HTML レポート生成 (`src/generate-report.ts`)

```typescript
import * as fs from 'fs';
import * as path from 'path';

function generateMonthlyReport(month: string) {
  const dataPath = path.join(__dirname, `../data/raw/${month}.json`);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // ユーザー別集計
  const userStats = {};
  for (const commit of data.commits) {
    const author = commit.author?.login || 'unknown';
    if (!userStats[author]) {
      userStats[author] = { commits: 0, prs: 0 };
    }
    userStats[author].commits++;
  }

  for (const pr of data.prs) {
    const author = pr.author.login;
    if (!userStats[author]) {
      userStats[author] = { commits: 0, prs: 0 };
    }
    userStats[author].prs++;
  }

  // HTMLレポート生成
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Productivity Report - ${month}</title>
  <style>
    body { font-family: sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
  </style>
</head>
<body>
  <h1>Productivity Report - ${month}</h1>
  <h2>User Statistics</h2>
  <table>
    <tr>
      <th>User</th>
      <th>Commits</th>
      <th>PRs Merged</th>
      <th>Trend</th>
    </tr>
    ${Object.entries(userStats).map(([user, stats]) => `
    <tr>
      <td>${user}</td>
      <td>${stats.commits}</td>
      <td>${stats.prs}</td>
      <td>${getTrend(stats)}</td>
    </tr>
    `).join('')}
  </table>
</body>
</html>
  `;

  const reportPath = path.join(__dirname, `../reports/${month}/index.html`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, html);
  console.log(`Report generated: ${reportPath}`);
}

function getTrend(stats: any): string {
  if (stats.commits > 30 && stats.prs > 5) return '↗️ High Performance';
  if (stats.prs > 5 && stats.commits < 20) return '🚀 Efficient (AI/PR split?)';
  if (stats.commits > 30 && stats.prs < 3) return '⚠️ Merge Bottleneck';
  if (stats.commits < 10 && stats.prs < 2) return '🔍 Needs Attention';
  return '➡️ Normal';
}
```

## 落とし穴 / アンチパターン

### 1. 日別ファイル生成による爆発的なファイル数増加

```bash
# ❌ Bad: 日別ファイル
data/
├── 2026-01-01.json
├── 2026-01-02.json
... (365ファイル/年)
```

**問題**: ファイル数が膨大になり、管理が困難になります。

**解決策**: 月別ファイルに集約。1.7MB/月程度なら問題ありません。

### 2. gh コマンドのエラーハンドリング不足

```typescript
// ❌ Bad: エラーを無視
const output = execSync(`gh repo list ${org}`, { encoding: 'utf-8' });
```

**問題**: `gh`コマンド失敗時にスクリプトが停止します。

**解決策**: try-catchでエラーハンドリング、ログ出力。

```typescript
// ✅ Good
try {
  const output = execSync(`gh repo list ${org}`, { encoding: 'utf-8' });
  return JSON.parse(output);
} catch (error) {
  console.error(`Failed to fetch repos for ${org}:`, error.message);
  return [];
}
```

### 3. レート制限の考慮不足

```typescript
// ❌ Bad: 短時間に大量リクエスト
for (const repo of repos) {
  const commits = execSync(`gh api repos/${org}/${repo}/commits`);
}
```

**問題**: GitHub APIのレート制限（5000リクエスト/時）に引っかかります。

**解決策**: レート制限をチェック、適切な間隔で実行。

```typescript
// ✅ Good: レート制限確認
const rateLimit = JSON.parse(
  execSync('gh api rate_limit', { encoding: 'utf-8' })
);
console.log(`Remaining: ${rateLimit.resources.core.remaining}`);

if (rateLimit.resources.core.remaining < 100) {
  console.warn('Approaching rate limit, pausing...');
  await sleep(60000); // 1分待機
}
```

### 4. コミット数だけで評価する

```typescript
// ❌ Bad: 単一指標での評価
if (commits > 50) {
  console.log('High performer!');
}
```

**問題**: コミット数が多くてもPRがマージされていなければ、ボトルネックがあります。

**解決策**: 複数指標を組み合わせて傾向を分析。

## 判断基準

### いつファイルベースを使うべきか

✅ **使うべき状況**:
- データ量が月数MB程度
- 複雑なクエリが不要
- Git管理したい
- インフラコストを最小化したい
- 運用保守を最小限にしたい

### いつgh コマンドを使うべきか

✅ **使うべき状況**:
- シンプルな実装を優先
- GitHub Actionsで実行
- デバッグを容易にしたい
- 追加の依存関係を避けたい

❌ **Octokitを検討すべき状況**:
- 細かいエラーハンドリングが必要
- TypeScriptで型安全に実装したい
- 並列処理を細かく制御したい

### いつYouTrack連携が必要か

✅ **連携すべき状況**:
- タスクの起案者や目的を分析したい
- プロジェクト別の生産性を把握したい
- カスタムフィールドの情報が必要

## 参考文献

- [GitHub CLI (gh) Documentation](https://cli.github.com/manual/)
- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [Octokit.js Documentation](https://github.com/octokit/octokit.js)
- [YouTrack REST API Documentation](https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
