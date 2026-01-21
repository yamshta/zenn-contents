---
title: "アプリ内Analyticsデバッグビューア: 非エンジニア向けUI設計の実践"
emoji: "🔍"
type: "tech"
topics: ["android", "ios", "analytics", "デバッグ", "jetpackcompose"]
published: false
---

## 背景

モバイルアプリでAdobe AnalyticsやFirebase Analyticsなどの計測を実装する際、ディレクターやQA担当者が「適切なイベントが発火しているか」「重複がないか」を確認したいという要望がよくあります。しかし、従来の確認方法には以下の課題がありました:

- **Logcatでの確認**: エンジニアでないと操作が難しい
- **デバッグビルドの配布**: 本番に近い環境での検証ができない
- **外部ツール**: リアルタイムで確認できない、セットアップが複雑

本記事では、**アプリ内で完結する**Analyticsデバッグビューアを実装し、非エンジニアでも簡単に計測状況を確認できるようにした設計パターンを紹介します。

## 要点

1. **ログカテゴリの明確な分離**
   初期化・設定ログと、実際の発火ログを別カテゴリに分類することで、ノイズを削減

2. **アプリ内フルスクリーンUI**
   Logcatではなくアプリ内で完結する専用画面を実装し、非エンジニアでも操作可能に

3. **フィルタリング機能**
   「全ログ」と「Analytics発火のみ」を切り替えて、目的に応じた表示を実現

4. **展開可能なパラメータ表示**
   送信されたパラメータの詳細をタップで確認でき、重複やデータの正確性を検証

5. **ビルドバリアント対応**
   RELEASEビルドでは必要最小限のログのみ記録し、メモリ消費を抑制

## 詳細

### 1. 設計思想: ログカテゴリの分離

Analyticsツールのログは大きく2種類に分類できます:

| カテゴリ | 内容 | 対象者 | 例 |
|---------|------|--------|-----|
| **設定・初期化ログ** | SDK初期化、設定読み込み、ID管理 | エンジニア | `Adobe Analytics SDK初期化完了` |
| **実際の発火ログ** | `trackState()`, `trackAction()`の呼び出し | ディレクター・QA | `trackState: productList (8項目)` |

ディレクターが知りたいのは**「どのイベントが発火したか」**であり、初期化ログはノイズになります。そこで、ログカテゴリを明確に分離します。

#### Android実装例

```kotlin
// AnalyticsDebugType.kt
enum class AnalyticsDebugType {
    SCREEN_VIEW,       // 画面表示
    EVENT,             // イベント
    ADOBE_FIRE,        // 🔥 Adobe Analytics SDK実発火（ディレクター確認用）
    // ...
}
```

```kotlin
// AdobeAnalyticsService.kt
fun trackScreen(screenName: String, parameters: Map<String, Any?>) {
    // Adobe SDKに送信
    MobileCore.track(state = screenName, contextData = parameters)

    // 🔥 発火ログのみ記録
    analyticsDebugManager.logAdobeFire(
        methodName = "trackState",
        actionName = screenName,
        parameters = parameters
    )
}
```

#### iOS実装例

```swift
// Logger.swift
enum LogCategory: String {
    case analytics = "Analytics"          // 一般的なログ
    case adobeAnalytics = "AdobeAnalytics" // 🔥 発火ログ専用
    // ...

    var emoji: String {
        switch self {
        case .adobeAnalytics: return "🔥"
        // ...
        }
    }
}
```

```swift
// AnalyticsService.swift
func trackScreen(_ screenName: String, parameters: [String: Any]) {
    // Adobe SDKに送信
    ACPCore.track(state: screenName, data: parameters)

    // 🔥 発火ログのみ記録
    Logger.log(.adobeAnalytics, "trackState送信完了 - \(screenName)\nParameters: \(parameters)")
}
```

### 2. アプリ内ログビューアの実装

#### Material Design 3を使ったUI構成

```kotlin
@Composable
fun AnalyticsLogViewerScreen(
    onNavigateBack: () -> Unit,
    viewModel: AnalyticsLogViewerViewModel = hiltViewModel()
) {
    val debugMessages by viewModel.debugMessages
    val showAdobeFireOnly by viewModel.showAdobeFireOnly.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Analytics ログビューア") },
                navigationIcon = { BackButton(onClick = onNavigateBack) },
                actions = {
                    // ログクリアボタン
                    IconButton(onClick = { viewModel.showClearConfirmation = true }) {
                        Icon(Icons.Default.Delete, "ログをクリア")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // 統計情報
            LogStatistics(
                totalCount = debugMessages.size,
                adobeFireCount = viewModel.adobeFireCount.collectAsState().value
            )

            // フィルタチップ
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = !showAdobeFireOnly,
                    onClick = { viewModel.setShowAdobeFireOnly(false) },
                    label = { Text("すべて (${debugMessages.size})") }
                )
                FilterChip(
                    selected = showAdobeFireOnly,
                    onClick = { viewModel.setShowAdobeFireOnly(true) },
                    label = { Text("🔥 Adobe発火のみ (${viewModel.adobeFireCount.value})") }
                )
            }

            HorizontalDivider()

            // ログ一覧
            LazyColumn {
                items(
                    items = filteredMessages,
                    key = { it.id } // パフォーマンス最適化
                ) { message ->
                    AnalyticsLogItem(
                        message = message,
                        onExpandToggle = { /* 展開状態切り替え */ }
                    )
                }
            }
        }
    }
}
```

#### 展開可能なログアイテム

```kotlin
@Composable
fun AnalyticsLogItem(
    message: AnalyticsDebugMessage,
    onExpandToggle: () -> Unit
) {
    var expanded by rememberSaveable(message.id) { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clickable { expanded = !expanded }
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // サマリー行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "${message.type.emoji} ${message.title}",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = message.timestamp.format("HH:mm:ss.SSS"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // パラメータ数表示
            if (message.parameters.isNotEmpty()) {
                Text(
                    text = "${message.parameters.size}項目のパラメータ",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            // 展開時の詳細表示
            if (expanded && message.parameters.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "パラメータ:",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold
                )
                message.parameters.forEach { (key, value) ->
                    Text(
                        text = "  • $key = $value",
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }
        }
    }
}
```

### 3. ViewModelでの状態管理とパフォーマンス最適化

```kotlin
@HiltViewModel
class AnalyticsLogViewerViewModel @Inject constructor(
    private val analyticsDebugManager: AnalyticsDebugManager
) : ViewModel() {

    // ログメッセージの購読
    val debugMessages = analyticsDebugManager.debugMessages

    // フィルタ状態
    private val _showAdobeFireOnly = MutableStateFlow(false)
    val showAdobeFireOnly: StateFlow<Boolean> = _showAdobeFireOnly.asStateFlow()

    // Adobe発火カウントの事前計算（パフォーマンス最適化）
    val adobeFireCount: StateFlow<Int> = debugMessages
        .map { messages -> messages.count { it.type == AnalyticsDebugType.ADOBE_FIRE } }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = 0
        )

    // ログクリア（確認ダイアログ経由）
    var showClearConfirmation by mutableStateOf(false)
        private set

    fun clearLogs() {
        analyticsDebugManager.clearLogs()
        showClearConfirmation = false
    }

    fun setShowAdobeFireOnly(enabled: Boolean) {
        _showAdobeFireOnly.value = enabled
    }
}
```

### 4. ビルドバリアント対応: メモリ消費の最適化

RELEASEビルドでは、全てのログを記録するとメモリを圧迫します。そこで、`BuildConfig.DEBUG`で条件分岐します。

```kotlin
@Singleton
class AnalyticsDebugManager @Inject constructor() {

    private val _debugMessages = MutableStateFlow<List<AnalyticsDebugMessage>>(emptyList())
    val debugMessages: StateFlow<List<AnalyticsDebugMessage>> = _debugMessages.asStateFlow()

    fun addDebugMessage(message: AnalyticsDebugMessage) {
        if (BuildConfig.DEBUG) {
            // DEBUGビルド: 全てのログを記録
            _debugMessages.value = (_debugMessages.value + message).takeLast(50)
        } else {
            // RELEASEビルド: ADOBE_FIREのみ記録
            if (message.type == AnalyticsDebugType.ADOBE_FIRE) {
                _debugMessages.value = (_debugMessages.value + message).takeLast(20)
            }
        }
    }
}
```

### 5. ナビゲーション統合

ログビューアを「その他」メニューから簡単にアクセスできるようにします。

```kotlin
// Screen.kt
sealed class Screen(val route: String) {
    object Others : Screen("others")
    object AnalyticsLogViewer : Screen("analytics_log_viewer")
}

// TabiNavHost.kt
@Composable
fun TabiNavHost(navController: NavHostController) {
    NavHost(navController, startDestination = Screen.Home.route) {
        composable(Screen.Others.route) {
            OthersMenuScreen(
                onNavigateToAnalyticsLogViewer = {
                    navController.navigate(Screen.AnalyticsLogViewer.route)
                }
            )
        }

        composable(Screen.AnalyticsLogViewer.route) {
            AnalyticsLogViewerScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}
```

### 6. 使い方（ディレクター向け手順）

1. **アプリ起動**
2. **「その他」タブをタップ**
3. **「開発者向け」セクションまでスクロール**
4. **「ログビューア」をタップ**
5. **フィルタボタンで「🔥 Adobe発火のみ」を選択**
6. **ログをタップしてパラメータ詳細を確認**

これで、Adobe Analyticsの実際の発火だけが一覧表示され、重複や誤った計測を簡単にチェックできます。

## 落とし穴 / アンチパターン

### ❌ 初期化ログと発火ログを混在させる

```kotlin
// ❌ 悪い例: 全て同じカテゴリ
Logger.log(.analytics, "Adobe Analytics SDK初期化")
Logger.log(.analytics, "trackState: productList") // 発火ログがノイズに埋もれる
```

```kotlin
// ✅ 良い例: カテゴリを分離
Logger.log(.analytics, "Adobe Analytics SDK初期化")
Logger.log(.adobeAnalytics, "🔥 trackState: productList") // 明確に分離
```

### ❌ RELEASEビルドで全ログを記録

```kotlin
// ❌ 悪い例: メモリリーク
fun addDebugMessage(message: AnalyticsDebugMessage) {
    _debugMessages.value += message // 無制限に蓄積
}
```

```kotlin
// ✅ 良い例: ビルドバリアントで制御
fun addDebugMessage(message: AnalyticsDebugMessage) {
    if (BuildConfig.DEBUG || message.type == AnalyticsDebugType.ADOBE_FIRE) {
        _debugMessages.value = (_debugMessages.value + message).takeLast(50)
    }
}
```

### ❌ LazyColumnでkeyを指定しない

```kotlin
// ❌ 悪い例: 再コンポーズ時にパフォーマンス低下
LazyColumn {
    items(debugMessages) { message ->
        AnalyticsLogItem(message)
    }
}
```

```kotlin
// ✅ 良い例: keyで最適化
LazyColumn {
    items(items = debugMessages, key = { it.id }) { message ->
        AnalyticsLogItem(message)
    }
}
```

### ❌ 機密情報をそのまま表示

パスワードやトークンがパラメータに含まれる場合、そのまま表示するとセキュリティリスクになります（ただし、本実装ではディレクターからの要望により、マスキングは行わない判断となりました）。

セキュリティが重要な場合は、以下のようなマスキング処理を検討してください:

```kotlin
private fun maskSensitiveValue(key: String, value: Any?): String {
    val sensitiveKeys = setOf("password", "token", "apiKey", "secret")
    return if (sensitiveKeys.any { key.contains(it, ignoreCase = true) }) {
        "***MASKED***"
    } else {
        value.toString()
    }
}
```

## 判断基準

### いつ使うか

- ✅ QA・ディレクターが自分でAnalytics計測を確認したい
- ✅ 本番環境に近い状態でデバッグしたい（adbを使わずに）
- ✅ 重複イベントや誤った計測を素早く発見したい
- ✅ 外部ツールへのデータ反映を待たずにリアルタイムで確認したい

### いつ使わないか

- ❌ エンジニアだけが確認する場合（Logcatで十分）
- ❌ Analyticsツールの管理画面で十分確認できる場合
- ❌ ログ記録のメモリ消費が問題になる極小デバイス

## 参考文献

- [Material Design 3 - Components](https://m3.material.io/components)
- [Jetpack Compose - LazyColumn Performance](https://developer.android.com/jetpack/compose/lists#item-keys)
- [Adobe Experience Platform Mobile SDK - Track API](https://developer.adobe.com/client-sdks/documentation/mobile-core/api-reference/#track)
- [Android Developers - ViewModel and State](https://developer.android.com/topic/libraries/architecture/viewmodel)
- [SwiftUI - Presentation Management](https://developer.apple.com/documentation/swiftui/view-presentation)
