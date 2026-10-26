# 完整单位的正文资料样例

由`scripts/inspect-story-ai-context.ts`通过实际事务和narrativeProjection生成，未手工编造投影内容。

`story-context.txt`是插件给普通正文AI的完整动态上下文。`story-edit-request-context.txt`使用明确修改档案的请求生成；普通正文不会因此获得scan专用的内部编辑资料。`secondary-scan-context.txt`展示副API扫描使用的详细资料。`unit-record.json`是相同单位的完整存档，用来对照未发送的字段。

样例单位：再生赤翼骑兵连，训练L5，80/100人，有主副武器、重甲、中盾、三项技能、三项固有特质、治疗药水和夜视镜；普通流血3轮；风神赐福剩2场，寒霜侵蚀剩3轮。

这是插件追加的上下文，不代表宿主拼接后的完整模型请求。内置世界书“技能与效果”条目也会独立注入。
