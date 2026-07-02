# 修复历史记录多设备同步覆盖问题

## 问题分析

### 当前架构

**后端** (`functions/api/history/[[action]].js`)：
- `/sync`：接收完整 history 数组，按 `show_identifier` 做 UPSERT，最后 trim 到 50 条
- `/progress`：只更新单条记录的 `playback_position` 和 `duration`

**前端** (`js/player.js`)：
- `saveToHistory()`：构建当前视频的 videoInfo，合并到内存缓存 `window._viewingHistoryCache`，然后**同步完整 history 数组**到云端
- `saveCurrentProgress()`（上次改动后）：更新内存缓存中的进度，**同步完整 history 数组**到云端

### 多设备覆盖问题

场景：设备 A 正在看视频 X，设备 B 在看视频 Y

1. 设备 A：`saveToHistory()` → 同步完整 history `[X]` 到 D1 → D1 中有 X
2. 设备 A：`saveCurrentProgress()` → 同步完整 history `[X]` 到 D1 → 没问题
3. 设备 B：`saveToHistory()` → 同步完整 history `[Y]` 到 D1 → 但 B 的 history 里**没有 X**！
4. 虽然 `/sync` 是 UPSERT 不会删除 X，但如果 B 的 history 时间戳更新，D1 的 trim 逻辑可能踢掉 A 的旧记录

**但更核心的问题是**：`saveToHistory()` 和 `saveCurrentProgress()` 都在同步完整 history，而不同设备持有的 history 数组不同，这本身就是错误的设计。

### 根本原因

`saveToHistory()` 不应该同步完整 history 数组。它只需要同步**当前视频这一条记录**。D1 数据库本身已经有排序和去重能力（`UPSERT ON CONFLICT(show_identifier)` + `ORDER BY timestamp DESC LIMIT 50`）。

## 修改方案

### 核心思路

1. **`saveToHistory()`**：只同步当前视频的单条记录到云端（不是完整数组）
2. **`saveCurrentProgress()`**：恢复使用 `/progress` 端点（只更新进度字段，不覆盖完整记录）
3. 内存缓存 `window._viewingHistoryCache` 仍维护完整 history，但仅用于本地展示，不作为同步数据源

### 具体修改

#### 1. `js/cloud-sync.js` — 新增 `syncItem` 方法

```js
// 同步单条记录到云端（不覆盖其他记录）
async syncItem(item) {
    if (!(await this.isEnabled()) || !item) return false;
    try {
        await fetch(this.API_BASE + '/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: [item] })
        });
        return true;
    } catch (e) {
        console.warn('[CloudSync] syncItem failed:', e.message);
        return false;
    }
}
```

#### 2. `js/player.js` — `saveToHistory()`：只同步单条记录

将文件末尾的云端同步调用从：
```js
CloudSync.isEnabled().then(enabled => {
    if (enabled) CloudSync.debouncedSync([...history]);
});
```
改为：
```js
CloudSync.isEnabled().then(enabled => {
    if (enabled) CloudSync.syncItem(videoInfo);
});
```

保留内存缓存的更新逻辑不变（`window._viewingHistoryCache = history` + 排序 + 限制 50 条）。

#### 3. `js/player.js` — `saveCurrentProgress()`：恢复使用 `/progress` 端点

将：
```js
CloudSync.isEnabled().then(enabled => {
    if (enabled) CloudSync.debouncedSync([...history]);
});
```
改回：
```js
if (typeof CloudSync !== 'undefined' && history[idx].showIdentifier) {
    CloudSync.isEnabled().then(enabled => {
        if (enabled) CloudSync.updateProgress(history[idx].showIdentifier, currentTime, duration);
    });
}
```

保留内存缓存的更新逻辑不变。

#### 4. `js/ui.js` — `addToViewingHistory()`：同样只同步单条

`addToViewingHistory` 目前未被调用，但为了一致性，也改为调用 `CloudSync.syncItem(videoInfo)` 而非 `pushHistoryToCloud()`。

### 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `js/cloud-sync.js` | 新增 `syncItem(item)` 方法 |
| `js/player.js` | `saveToHistory()` 改用 `syncItem`；`saveCurrentProgress()` 恢复 `/progress` |
| `js/ui.js` | `addToViewingHistory()` 改用 `syncItem`（一致性） |

### 数据流（修改后）

```
设备 A 看视频 X:
  saveToHistory()       → syncItem({X})      → D1 UPSERT X
  saveCurrentProgress() → /progress          → D1 UPDATE X.playback_position

设备 B 看视频 Y:
  saveToHistory()       → syncItem({Y})      → D1 UPSERT Y（不影响 X）
  saveCurrentProgress() → /progress          → D1 UPDATE Y.playback_position

任意设备加载首页:
  syncHistoryFromCloud() → /load             → D1 返回 X + Y（按 timestamp 排序）
```

## 验证

1. 设备 A 打开视频 X 播放一段时间 → 检查 D1 中 X 有正确的 playback_position
2. 设备 B 打开视频 Y → 检查 D1 中 X 的 playback_position 未被覆盖
3. 设备 B 打开首页 → 历史记录中应同时显示 X 和 Y，且 X 有进度条