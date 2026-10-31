# Gate × IC 手机行情观察

个人只读市场看板，部署到 GitHub Pages。来源分别显示价格、15m/1h/4h 方向、动能评分、量比/Tick 比、机会状态，以及有效的入场/止损/止盈观察区间。

## 数据链路

电脑继续运行原有监控 → `export_snapshot.py` 按字段白名单导出公开行情 → `publish.py` 约每 30 秒更新本仓库 `feed` 分支的 `snapshot.json` → 页面每 10 秒读取一次。

电脑休眠、断网、同步失败时，页面按原始时间戳暂停过期数据。网络和 GitHub 缓存会造成延迟；页面不保证持续实时，也不代替交易所止损。分数不是胜率，条件满足仍需人工核对。网页不自动下单，也不发送交易提醒。

仅网页和公开行情快照上传本仓库。账号、服务器标识、个人仓位、盈亏、历史截图、本地路径和凭证不导出。`publish.py` 使用电脑现有的 GitHub CLI 登录，令牌不写入代码或页面。

## 本地设置

将配置放在被 Git 忽略的 `.local/publisher.json`：

```json
{"repository":"OWNER/REPOSITORY","source":"/absolute/path/to/combined/snapshot.json"}
```

运行 `python3 publish.py --watch`。进程锁防止重复同步；每轮失败后等待下一轮，不改变原监控。网站配置为 `dist/config.json`。`feed` 更新不会触发网页重复部署。

## 检查

`python3 -B -m unittest discover -s tests` 验证白名单与隐私隔离；`npm test` 验证新鲜度、计划失效、来源隔离和分数边界。

网页采用 Data terminal 深色布局（设计种子 1928482506）：手机将行情表转成可展开的列表，保留来源与有效期。字体 Public Sans 使用 SIL Open Font License，文件见字体许可。
