---
title: "Cursor AgentでiOS開発を加速させる実践テクニック"
emoji: "🤖"
type: "tech"
topics: ["ios", "cursor", "ai", "swift", "xcodeGen"]
published: true
---

**みなさん、コード書くのに時間かかりすぎてませんか？**

アイデアから実装までの道のりで、ボイラープレートコードやおなじみのパターンを何度も書き直すことにうんざりしていませんか？

私も同じ悩みを抱えていました。そんな中で出会ったのがCursor Agentです。
単なるコード補完ツールではなく、あなたの開発パートナーとして機能するAIアシスタントです。

本記事では個人アプリ開発での経験をもとに、Cursor AgentをiOS開発に組み込む具体的なテクニックをご紹介します。

## Xcode vs Cursor: 対立ではなく共存を目指す

最初に陥りがちな罠は **「XcodeをCursorで完全に置き換えよう」** という考え方です。
実際には、両者の強みを活かした役割分担が理想的です。

### Xcodeが優れている領域
- ビルド・実行環境としての安定性
- SwiftUIプレビューやインタラクティブデバッグ
- シミュレーター連携と実機テスト

### Cursor Agentの強み
- プロジェクト全体を理解したコード生成
- アーキテクチャ設計の提案と実装
- ボイラープレートコードの自動生成

私の直近の開発スタイルは、アーキテクチャ設計や基本実装はCursor Agentで行い、UI実装や細かいデバッグは人間がXcodeで対応するといった役割分担をしています。


## プロジェクト構成の最適化: AIと協調するための布石

Cursorを最大限活用するには、AIが理解しやすいプロジェクト構造が重要です。
そこで鍵となるのがXcodeGenです。

XcodeGenを採用することで以下のメリットがあります。
1. プロジェクト設定をYAMLという人間（とAI）にとって読みやすい形式で管理できる
2. チーム開発における.xcodeprojのマージ地獄から解放される
3. **Cursor Agentにプロジェクトの依存関係や構造を明示的に伝えられる**


ディレクトリ構造も重要です。責務に基づいた明確な層分けを行うことで、AIはコードの目的と位置づけを正確に理解できます。

```
MyApp/
├── Sources/
│   ├── Presentation/ # UI層
│   ├── Domain/       # ビジネスロジック層
│   └── Data/         # データアクセス層
└── Tests/
```

## Folder参照でXcodeとCursorを連携させる

Cursor AgentでiOS開発する上では、XcodeのFolder参照を採用することが重要です。

Group参照では、Cursor Agentがファイルを作成しても、自動でXcodeプロジェクトに追加されず、「file not found」エラーに悩まされます。Folder参照（青いフォルダアイコン）を使えば、この問題は解決します。


| 特性 | Group | Folder |
| ---- | ----- | ------ |
| 表示 | 黄色フォルダ | 青色フォルダ |
| 連携 | ファイルシステム非連動 | ファイルシステム連動 |
| Agent対応 | 悪い | 良い |


しかし、XcodeGenでは現在Folder参照としてファイルを管理する機能がありません。（正確にいうと、指定したフォルダをFolder参照として読み込む機能はありますが、Folder参照のフォルダを生成する機能がありません。）

そのため、XcodeGenで生成したプロジェクトをFolder参照に変換する自動化スクリプトを導入することで、シームレスな連携が実現できます。

以下のようなスクリプトを定期実行するようにCursor Ruleに含めています。

```swift
// The Swift Programming Language
// https://docs.swift.org/swift-book

import Foundation
import PathKit
import XcodeProj

// 設定項目
let projectPath = "../ExampleApp.xcodeproj" // プロジェクトファイルのパス（Scripts ディレクトリからの相対パス）
let targetName = "ExampleApp" // ターゲット名
let projectSourceRoot = ".." // プロジェクトのソースルートディレクトリ
// すべてのグループを処理する
let groupsToConvert = ["Presentation", "Domain", "Data"] // メインターゲット内の最上位グループ

// メイン処理
do {
    print("GroupをFolderに変換するスクリプトを開始します...")
    let xcodeProjPath = Path(projectPath)
    let xcodeProj = try XcodeProj(path: xcodeProjPath)
    let sourceRootPath = Path(projectSourceRoot)

    // プロジェクトのルートディレクトリを確認
    guard sourceRootPath.exists else {
        print("エラー: プロジェクトソースルートディレクトリが見つかりません: \(sourceRootPath.absolute())")
        exit(1)
    }

    print("プロジェクトルートパス: \(sourceRootPath.absolute())")

    // ルートグループを取得
    guard let rootGroup = try xcodeProj.pbxproj.rootGroup() else {
        print("エラー: ルートグループが見つかりません")
        exit(1)
    }

    // プロジェクトのメインターゲットグループを取得
    let mainTargetGroups = rootGroup.children.compactMap { $0 as? PBXGroup }.filter { $0.name == targetName || $0.path == targetName }
    guard let mainGroup = mainTargetGroups.first else {
        print("エラー: メインターゲットグループ '\(targetName)' が見つかりません")
        exit(1)
    }

    print("メインターゲットグループ内のグループ一覧:")
    for child in mainGroup.children {
        if let group = child as? PBXGroup {
            print(" - \(group.name ?? group.path ?? "Unknown")")
        }
    }

    // メインターゲットのパス（存在しない場合は作成）
    let targetPath = sourceRootPath + Path(targetName)
    if !targetPath.exists {
        try targetPath.mkdir()
        print("ターゲットディレクトリを作成しました: \(targetPath)")
    }

    // 各トップレベルグループを処理
    for groupName in groupsToConvert {
        print("\n[\(groupName)] グループの変換を開始...")

        // 対象グループを検索
        if let targetGroup = mainGroup.children.first(where: { ($0 as? PBXGroup)?.name == groupName || ($0 as? PBXGroup)?.path == groupName }) as? PBXGroup {
            // グループを再帰的にフォルダ変換
            try convertGroupToFolder(group: targetGroup, basePath: targetPath, pbxproj: xcodeProj.pbxproj)
            print("[\(groupName)] グループの変換が完了しました")
        } else {
            print("[\(groupName)] グループが見つかりません")
        }
    }

    // プロジェクトファイルを保存
    try xcodeProj.write(path: xcodeProjPath)
    print("\nプロジェクトファイルを保存しました")
    print("処理が完了しました。XcodeGenを実行してプロジェクトを更新してください。")
} catch {
    print("エラーが発生しました: \(error.localizedDescription)")
    exit(1)
}

// グループを再帰的にフォルダに変換する関数
func convertGroupToFolder(group: PBXGroup, basePath: Path, pbxproj: PBXProj) throws {
    // グループ名を取得
    let groupName = group.name ?? group.path ?? "unknown"
    print("  処理中: \(groupName)")

    // フォルダパスを作成
    let folderPath = basePath + Path(groupName)
    print("  フォルダパス: \(folderPath)")

    // フォルダが存在しない場合は作成
    if !folderPath.exists {
        try folderPath.mkdir()
        print("  フォルダを作成しました: \(folderPath)")
    }

    // グループをフォルダ参照に設定
    group.sourceTree = .group
    if group.path == nil {
        group.path = groupName
    }

    // 子グループを再帰的に処理
    let childGroups = group.children.compactMap { $0 as? PBXGroup }
    for childGroup in childGroups {
        try convertGroupToFolder(group: childGroup, basePath: folderPath, pbxproj: pbxproj)
    }

    // このグループ内のファイル参照を処理
    let fileRefs = group.children.compactMap { $0 as? PBXFileReference }
    for fileRef in fileRefs {
        if let fileName = fileRef.name ?? fileRef.path {
            print("  ファイル: \(fileName)")
            // ファイル参照も相対パスに設定
            fileRef.sourceTree = .group
        }
    }
}
```


スクリプト自体は、以下の記事を参考にさせていただきました。

https://note.com/reality_eng/n/nb7133c726442

## AIに明確な指示を: Cursor Rulesの活用

Cursor Agentの出力品質を上げるための秘訣は、プロジェクト固有のルールを定義することです。

```bash
# .cursor/rules/ディレクトリに配置
.cursor/
└── rules/
    ├── project.mdc    # プロジェクト全体のルール
    ├── architecture.mdc # アーキテクチャ指針
    └── swift-style.mdc  # コーディング規約
```

ルールの内容は具体的なディレクトリ構造やコード例を含め、抽象的な指示ではなく具体的なパターンを示すようにします。こうすることで、Agentはあなたのプロジェクト固有の規約に従ったコードを生成できます。

```markdown
# iOS アプリケーション開発ガイドライン例

## アーキテクチャ設計原則
- Clean Architecture + MVVM パターンを採用
- Domain 層は外部フレームワークに依存しない純粋な実装に

## コーディング規約
- プロパティ名はキャメルケース（firstName）
- 型名はパスカルケース（UserProfile）
- プライベートメソッドには接頭辞_を付けない
```

## 要件から実装へ: 高レベル設計ドキュメントの活用

Cursor Agentとの効果的な協業で最も価値を発揮するのが、High-Level Design Document (HLDD)の作成です。

要件から直接コードを生成するのではなく、まずは設計ドキュメントを作成してもらうことで:
1. 実装前に設計の妥当性を検証できる
2. データモデルやアーキテクチャの一貫性を確保できる
3. 開発者とAIの間で共通理解を形成できる

たとえば「リアルタイムチャット機能」を実装する際には、以下のようなHLDDを先に作成します:

```markdown
# リアルタイムチャット機能 - 設計仕様書

## 1. 機能概要
ユーザー間でのリアルタイムメッセージ交換を実現

## 2. データモデル
- Message（id, content, status）
- Conversation（participants, messages）

## 3. アーキテクチャ設計
- Presentation層: SwiftUI+ViewModel
- Domain層: UseCase+Entities
- Data層: FirebaseRepository実装

## 4. 主要フロー
- メッセージ送信フロー
- リアルタイム更新の仕組み
```

このドキュメントを`/docs`に出力するようにし、それらをベースに反復的に実装を進めることで、一貫性のある高品質なコードベースを構築できます。

## コード品質の維持: 不要コードの検出

AIが生成するコードの課題として、不要コードや重複が発生しやすい点があります。Peripheryのような静的解析ツールを導入することで、こうした問題を早期に発見・除去できます。

## 実行コードの再現性を高める: Makefileの用意

また、このようなコマンド群をMakefileにまとめておくとAgentに実行させる際も再現性が高くなります。

```Makefile
.PHONY: help setup generate build clean test lint periphery xcodegen all agent-verify verify-only

# デフォルトターゲット
all: generate build

# ヘルプコマンド
help:
	@echo "使用可能なコマンド:"
	@echo "  make setup        - 開発環境のセットアップ（必要なツールのインストール）"
	@echo "  make generate     - XcodeGenを使用してXcodeプロジェクトを生成"
	@echo "  make build        - プロジェクトをビルド"
	@echo "  make clean        - ビルド成果物を削除"
	@echo "  make test         - テストを実行"
	@echo "  make lint         - コード品質チェック"
	@echo "  make periphery    - 未使用コードを検出"
	@echo "  make all          - プロジェクトの生成とビルドを実行"
	@echo "  make agent-verify - Cursor Agent用のビルド検証（グループ変換、XcodeGen実行とビルド）"
	@echo "  make verify-only  - ビルド検証のみ実行（XcodeGen無し）"

# 環境セットアップ
setup:
	@echo "開発環境をセットアップしています..."
	@command -v xcodegen >/dev/null 2>&1 || brew install xcodegen
	@command -v periphery >/dev/null 2>&1 || (brew tap peripheryapp/periphery && brew install periphery)
	@cd Scripts && swift build
	@echo "セットアップ完了"

# XcodeGenによるプロジェクト生成
generate:
	@echo "Xcodeプロジェクトを生成しています..."
	xcodegen generate
	@echo "プロジェクト生成完了"

# ビルド
build:
	@echo "プロジェクトをビルドしています..."
	xcodebuild -project ExampleApp.xcodeproj -scheme ExampleApp -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 16" build | xcpretty || xcodebuild -project ExampleApp.xcodeproj -scheme ExampleApp -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 16" build
	@echo "ビルド完了"

# クリーン
clean:
	@echo "ビルド成果物を削除しています..."
	xcodebuild -project ExampleApp.xcodeproj -scheme ExampleApp clean
	rm -rf build/
	@echo "クリーン完了"

# テスト
test:
	@echo "テストを実行しています..."
	xcodebuild -project ExampleApp.xcodeproj -scheme ExampleApp -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 16" test | xcpretty || xcodebuild -project ExampleApp.xcodeproj -scheme ExampleApp -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 16" test
	@echo "テスト完了"

# リント（SwiftLintがインストールされている場合）
lint:
	@echo "コード品質チェックを実行しています..."
	@command -v swiftlint >/dev/null 2>&1 && swiftlint || echo "SwiftLintがインストールされていません。brew install swiftlintでインストールしてください。"

# Peripheryによる未使用コード検出
periphery:
	@echo "未使用コードを検出しています..."
	@mkdir -p unused_code_reports
	@./Scripts/unused_code_detector.sh
	@echo "未使用コード検出完了"

# XcodeGenを実行
xcodegen:
	@echo "XcodeGenを実行しています..."
	xcodegen generate
	@echo "XcodeGen実行完了"

# Scriptsディレクトリのプログラムを実行（グループをフォルダに変換）
convert-groups:
	@echo "📂 グループをフォルダに変換しています..."
	@cd Scripts && swift run
	@echo "📦 変換完了！XcodeGenを実行して変更を反映します..."
	@make xcodegen
	@echo "✅ 処理が完了しました！Xcodeで青いフォルダアイコンを確認してください"

# CI/CD環境での完全チェック
ci: setup generate lint build test periphery
	@echo "CI検証完了"

# Cursor Agent用ビルド検証（グループ変換、XcodeGen、ビルド）
agent-verify:
	@echo "🔄 Cursor Agent: ファイル変更検出 - ビルド検証を開始します"
	@echo "📁 グループをフォルダに変換しています..."
	-@cd Scripts && swift run 2>/dev/null && echo "✅ グループ変換完了" || echo "⚠️ グループ変換中にエラーが発生しましたが処理を続行します"
	@echo "📂 XcodeGenを実行しています..."
	xcodegen generate
	@echo "🔨 ビルドを実行しています..."
	xcodebuild -project ExampleApp.xcodeproj -scheme ExampleApp -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 16" build -quiet | grep -E "error:|warning:" || echo "✅ ビルド成功: エラー・警告なし"
	@echo "✅ Cursor Agent: 検証完了"

# ビルド検証のみ（XcodeGen無し）
verify-only:
	@echo "🔄 ビルド検証を開始します（XcodeGen無し）"
	@echo "🔨 ビルドを実行しています..."
	xcodebuild -project ExampleApp.xcodeproj -scheme ExampleApp -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 16" build -quiet | grep -E "error:|warning:" || echo "✅ ビルド成功: エラー・警告なし"
	@echo "✅ 検証完了"
```



## 実践的なワークフロー: 段階的な実装アプローチ

Cursor Agentを活用する際は、一度に大量のコードを生成するのではなく、機能ごとに段階的に実装するアプローチが効果的です。

1. 要件を明確化
2. HLDDを作成
3. 基本的なデータモデルを実装
4. ビジネスロジックを実装
5. UI層を実装
6. テストを追加

このサイクルを小さく反復することで、途中での方向転換も容易になり、品質管理もしやすくなります。

以下はCursor Agentに対するプロンプト例です:

```
「位置情報共有機能」の要件からHLDDを作成してください。
ユーザーが友達とリアルタイムに位置を共有でき、グループ内で全員の
位置をマップで確認できる機能です。バッテリー消費を最小限に抑え、
特定の場所への出入りを通知する機能も含めてください。
```

## まとめ: AIと共に進化するiOS開発

Cursor Agentは単なるコード生成ツールではなく、開発プロセス全体を変革するパートナーです。適切な環境設定と役割分担を行うことで、創造的な部分に集中し、反復的な作業からは解放される新しい開発体験が得られます。

いきなり全てを変える必要はありません。XcodeGenの導入から始めて、徐々にCursor Agentを開発フローに組み込んでいくことをお勧めします。AIとの協働による開発効率の向上と、より高品質なアプリ開発を実現しましょう。
