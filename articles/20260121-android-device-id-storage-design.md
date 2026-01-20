---
title: "Android端末ID保存の設計判断：暗号化は本当に必要か？非推奨情報の検証と正しい実装方針"
emoji: "🔐"
type: "tech"
topics: ["android", "security", "ios", "design", "encryption"]
published: false
publication_name: "lclco"
---

## 背景

モバイルアプリ開発において、端末IDの保存方法は重要な設計判断です。特にiOS/Androidのクロスプラットフォーム開発では、以下の疑問に直面します：

- 「EncryptedSharedPreferencesが非推奨になった」という情報は正しいか？
- iOSのKeychainのように、Androidでもアンインストール後にIDを保持すべきか？
- 端末IDは暗号化して保存すべきか？

本記事では、これらの疑問に対する**技術的検証と設計判断の根拠**を解説します。特に「非推奨」という曖昧な情報に惑わされず、正しい判断を下すためのプロセスを紹介します。

## 要点

1. **「非推奨」情報の曖昧さ**: Keystore/EncryptedSharedPreferencesが「完全非推奨」という主張は誤り。Jetpack Security Cryptoのライブラリ状態の変化を誤解している可能性が高い
2. **Androidの永続性の限界**: アプリ内保存（EncryptedSharedPreferences/DataStore/Keystore）ではアンインストール後の永続化は不可能。これはOS仕様であり変更できない
3. **暗号化の必要性**: 端末IDは秘密情報ではないため、暗号化は不要。平文SharedPreferencesで十分
4. **iOS/Android差異の受容**: 永続性の差異はプラットフォーム仕様として受け入れ、継続性が必要ならサーバー側で管理する

## 詳細

### 1. 「非推奨」情報の検証

#### よくある誤解

Android界隈でよく聞く「非推奨」主張：

- ❌ **Keystoreが非推奨** → 誤り。Keystore自体が捨てられる類の話ではない
- ❌ **EncryptedSharedPreferencesが非推奨** → 誤り。「完全にやめろ」ではなく、ライブラリの立ち位置の変化（DataStoreやTinkへの誘導）を誤解している
- ⚠️ **Jetpack Security CryptoのAPIが揺れた** → これが「非推奨っぽい」の正体であることが多い

#### 正しい理解

```kotlin
// ❌ 「非推奨だから使うな」と判断するのは早計
// ✅ 何が非推奨なのか、なぜ非推奨なのかを検証する

// Jetpack Security Cryptoの状態確認
dependencies {
    implementation "androidx.security:security-crypto:1.1.0-alpha06"
    // alpha版であることが「非推奨」と誤解される原因
}
```

**重要な原則**:
- 「何が非推奨なのか」を曖昧にしたまま設計の根幹を決めるのは危険
- 情報源を確認し、公式ドキュメントで検証する
- 技術選定の判断基準は「推奨/非推奨」ではなく「要件に合うか」

### 2. iOS/Android永続性の現実

#### プラットフォーム別の仕様

| 項目 | iOS | Android | 変更可能性 |
|------|-----|---------|-----------|
| **保存場所** | Keychain（OS管理の特別領域） | アプリデータ領域 | 不可 |
| **アンインストール時** | 保持される（仕様） | **削除される（仕様）** | 不可 |
| **永続性** | 実現可能 | **実現不可能** | 不可 |
| **工場出荷時リセット** | 削除される | 削除される | 不可 |

#### Androidでの実装と限界

```kotlin
// ❌ これらは全てアンインストールで消える
// EncryptedSharedPreferences
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()
val prefs = EncryptedSharedPreferences.create(...)
// → アプリデータ領域。アンインストールで消える

// DataStore
val dataStore: DataStore<Preferences> = context.createDataStore(...)
// → アプリデータ領域。アンインストールで消える

// Keystore + SharedPreferences
val keyStore = KeyStore.getInstance("AndroidKeyStore")
// → 鍵は残る可能性があるが、データ本体が消える時点で復元不可能
```

**根本的事実**:
- Androidのアプリデータ領域は、アンインストールで**完全に削除される**
- 暗号化しても、Keystoreを使っても、この事実は変わらない
- iOSのKeychainはOS仕様として特別だが、Androidには同等の仕組みがない

### 3. 正しい実装方針

#### iOS: Keychain使用（既存のまま）

```swift
// ✅ Keychain利用で永続化
import KeychainAccess

let keychain = Keychain(service: "com.example.app")
let deviceId = keychain["deviceId"] ?? UUID().uuidString
keychain["deviceId"] = deviceId

// 特徴:
// - アンインストール後も保持
// - 工場出荷時リセットでのみ削除
```

#### Android: 平文SharedPreferences（シンプルに）

```kotlin
// ✅ 平文SharedPreferencesで十分
object DeviceIdentifier {
    private const val PREF_NAME = "app_prefs"
    private const val KEY_DEVICE_ID = "device_id"

    fun getDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        var deviceId = prefs.getString(KEY_DEVICE_ID, null)

        if (deviceId == null) {
            deviceId = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
        }

        return deviceId
    }
}

// 特徴:
// - シンプルで壊れにくい
// - アンインストールで削除される（仕様として受け入れる）
// - 暗号化不要（device_idは秘密情報ではない）
```

**重要な設計判断**:

1. **device_idは秘密情報ではない**
   - ユーザーを識別するための補助的な識別子
   - 改ざんされても直接的な被害はない（サーバー側で異常検知）
   - 暗号化のコスト vs 価値が見合わない

2. **Androidは「再インストール=新端末」を受け入れる**
   - これが最も安定した設計
   - iOS/Android間の差異は仕様として扱う

3. **継続性が必要ならサーバー側で管理**
   - 会員IDでユーザーを識別
   - device_idは補助的な識別子

### 4. 使用箇所への影響

#### 分析ツールへの影響

| 使用箇所 | iOS | Android | 影響 |
|---------|-----|---------|------|
| **Firebase Analytics** | 永続ID | 再インストールで新ID | Androidは新規ユーザー扱い |
| **Crashlytics** | 永続ID | 再インストールで新ID | Androidは新規デバイス扱い |
| **カスタム分析** | 永続ID | 再インストールで新ID | Androidはプロファイルリセット |
| **API通信** | 永続ID | 再インストールで新ID | サーバー側で対応必要 |

#### 運用上の対応

```kotlin
// サーバー側でのユーザー統合例
data class User(
    val userId: String,              // 会員ID（永続）
    val currentDeviceId: String,     // 現在のdevice_id
    val deviceHistory: List<String>  // 過去のdevice_id履歴
)

// 分析時の考慮事項
// iOS: device_idベースで継続追跡可能
// Android: 再インストールは新規ユーザーとしてカウント
// クロスプラットフォーム分析: 会員IDベースを推奨
```

### 5. PRDへの明記（ドキュメント化の実践）

設計判断を文書化する例：

```markdown
## 端末識別子の永続性に関するOS差分

### iOS
- Keychainを使用して端末識別子（device_id）を保存
- アプリのアンインストール後も識別子が保持される
- 再インストール時に同じ識別子が取得される
- 工場出荷時リセットでのみ削除される

### Android
- SharedPreferencesを使用して端末識別子（device_id）を保存
- **アプリのアンインストールにより識別子は削除される（OS仕様）**
- **再インストール時には新しい識別子が生成される**
- これはAndroidのアプリデータ管理の仕様であり、変更不可能

### 設計方針
- iOS/Androidの永続性の差異は**仕様として受け入れる**
- Androidの再インストールは「新しい端末」として扱う
- ユーザーの継続性が必要な機能は、会員IDなどサーバー側で管理する
- device_idは端末識別の補助的な識別子として位置づける

### 分析への影響
- Androidでは再インストールユーザーが「新規ユーザー」としてカウントされる
- これはプラットフォームの仕様であり、分析時に考慮する
- クロスプラットフォーム分析では、会員IDベースの分析を推奨
```

## 落とし穴とアンチパターン

### ❌ アンチパターン1: ANDROID_IDで「iOSと揃える」

```kotlin
// ❌ 間違った実装
val androidId = Settings.Secure.getString(
    context.contentResolver,
    Settings.Secure.ANDROID_ID
)
```

**問題**:
- Android 8.0以降、アプリごとに異なるANDROID_IDが返される
- 工場出荷時リセットで変わる可能性がある
- 複雑化するだけで、iOS/Androidの永続性を揃えることはできない

### ❌ アンチパターン2: デュアルID方式

```kotlin
// ❌ 不要な複雑化
data class DeviceIdentifiers(
    val temporaryId: String,  // SharedPreferences
    val persistentId: String  // ANDROID_ID or 独自実装
)
```

**問題**:
- 実装が複雑になる
- どちらを使うべきか判断が必要になる
- Androidの永続性の限界は変わらない

### ❌ アンチパターン3: 端末IDの暗号化

```kotlin
// ❌ 過剰な暗号化
val encryptedPrefs = EncryptedSharedPreferences.create(
    "device_prefs",
    masterKey,
    context,
    ...
)
encryptedPrefs.edit().putString("device_id", uuid).apply()
```

**問題**:
- device_idは秘密情報ではない（暗号化する価値が薄い）
- 実装が複雑になり、バグのリスクが増える
- MasterKey管理のコストが発生

**正しい実装**:
```kotlin
// ✅ シンプルに平文で保存
val prefs = context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
prefs.edit().putString("device_id", uuid).apply()
```

### ❌ アンチパターン4: 「非推奨」という情報だけで判断

```kotlin
// ❌ 検証せずに判断
// 「EncryptedSharedPreferencesは非推奨らしいから使わない」
// → なぜ非推奨なのか、代替案は何か、を検証していない
```

**正しいアプローチ**:
1. 情報源を確認（公式ドキュメント、Issue tracker）
2. 何が非推奨なのかを明確化（ライブラリ？API？使い方？）
3. 要件に照らして判断（暗号化が本当に必要か？）

## 判断基準

### 暗号化が必要なケース

| データ種別 | 暗号化 | 保存方法 | 理由 |
|-----------|--------|---------|------|
| **認証トークン** | ✅ 必須 | EncryptedSharedPreferences | 漏洩すると第三者がアクセス可能 |
| **APIキー** | ✅ 必須 | EncryptedSharedPreferences | 悪用リスクが高い |
| **個人情報（氏名、住所等）** | ✅ 必須 | EncryptedSharedPreferences | 法的要件（個人情報保護法） |
| **クレジットカード情報** | ✅ 必須 | PCI DSS準拠の方法 | 法的要件（PCI DSS） |

### 暗号化が不要なケース

| データ種別 | 暗号化 | 保存方法 | 理由 |
|-----------|--------|---------|------|
| **端末ID（UUID）** | ❌ 不要 | 平文SharedPreferences | 秘密情報ではない |
| **アプリ設定（テーマ等）** | ❌ 不要 | 平文SharedPreferences | 漏洩しても被害なし |
| **キャッシュデータ** | ❌ 不要 | 平文ファイル/DB | 公開情報の一時保存 |
| **ログ情報** | ❌ 不要 | 平文ファイル | デバッグ用途 |

### 意思決定フロー

```
端末IDを保存したい
    ↓
端末IDは秘密情報か？
    ├─ Yes → EncryptedSharedPreferences（稀なケース）
    └─ No  → 平文SharedPreferences
         ↓
アンインストール後も保持したい？
    ├─ Yes → サーバー側で会員ID管理を検討
    └─ No  → 平文SharedPreferencesで完了
```

### iOS/Android間の永続性差異

| 要件 | iOS実装 | Android実装 | 注意点 |
|------|---------|-------------|--------|
| **インストール期間中の一意性** | Keychain | SharedPreferences | 両OSで実現可能 |
| **アンインストール後の永続性** | Keychain | **実現不可能** | 仕様として受け入れる |
| **継続的なユーザー識別** | 会員ID推奨 | 会員ID必須 | サーバー側で管理 |

## まとめ

端末ID保存の設計判断における重要なポイント：

1. **「非推奨」情報は検証する**
   - 何が非推奨なのかを明確化
   - 公式ドキュメントで確認
   - 要件に照らして判断

2. **プラットフォーム仕様を受け入れる**
   - Androidはアンインストールでデータが消える
   - iOS/Android間の永続性を無理に揃えない
   - 差異を仕様として文書化

3. **暗号化は本当に必要か考える**
   - 端末IDは秘密情報ではない
   - 平文SharedPreferencesで十分
   - 暗号化は認証トークン等で使用

4. **継続性はサーバー側で管理**
   - device_idは補助的な識別子
   - 会員IDで永続的なユーザー識別
   - プラットフォーム差異の影響を最小化

技術選定において、曖昧な「非推奨」情報に惑わされず、要件と仕様に基づいた正しい判断を下すことが重要です。

## 参考文献

### 公式ドキュメント
- [Android Keystore System](https://developer.android.com/training/articles/keystore)
- [EncryptedSharedPreferences](https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences)
- [Jetpack Security](https://developer.android.com/jetpack/androidx/releases/security)
- [iOS Keychain Services](https://developer.apple.com/documentation/security/keychain_services)

### セキュリティガイドライン
- [OWASP Mobile Security Testing Guide](https://owasp.org/www-project-mobile-security-testing-guide/)
- [Android Security Best Practices](https://developer.android.com/topic/security/best-practices)

### データ永続性
- [Android Data Storage](https://developer.android.com/training/data-storage)
- [DataStore](https://developer.android.com/topic/libraries/architecture/datastore)
