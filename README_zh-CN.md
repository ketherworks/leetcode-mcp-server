# @ketherworks/leetcode-mcp-private

这是一个私有、本地运行、匿名只读的 LeetCode MCP 适配器，不是 LeetCode 官方集成。

边界固定如下：

- 只使用本地 `stdio`，只接受 `--site global|cn`。
- 禁止认证；传入 `--session` 或存在 `LEETCODE_SESSION` 时立即拒绝，且不输出凭据值。
- 只注册 `oj_capabilities`、`oj_health`、`oj_search_problems`、`oj_fetch_problem`。
- 不注册 resources、用户、比赛、题解、笔记、运行或提交能力。
- 只返回白名单字段；不输出 hints、similarQuestions、editorial、solution 或未知字段。
- 付费题不返回正文，而是返回 `oj.error/v1` 的 `policy.blocked` 错误。
- 该适配器标记为 `unofficial`，不提供 HTTP Server、Worker、缓存、代码执行或提交流程。

本地构建：

```bash
npm ci
npm run build
node build/index.js --site global
```

上游基线、许可证与第三方声明见 `UPSTREAM.md`、`LICENSE` 和 `THIRD_PARTY_NOTICES`。
