import type { NarrativeMessage } from '../../vendor/jev-core/src/index.js';
import type { NarrativeSource } from '../../engine/src/small/scene-intent.js';
const spatialWords = /城[内外门墙区镇]|桥|河[流道岸]|[东西南北]侧|高[地台]|山[坡脊口]|林[地缘间]|庭院|仓库|入口|通[道路]|驻守|列阵|退[守到]|渡口|唯一|座桥|处破口/g;
function paragraphs(text: string): string[] {
    return text.split(/\n\s*\n/).flatMap(p => p.length <= 1000 ? [p] : p.match(/[\s\S]{1,1000}/g) ?? []).map(p => p.trim()).filter(Boolean);
}
/** Keep spatial setup as well as the latest events within the existing per-message budget. */
export function selectSpatialNarrative(text: string, budget = 6000): string {
    if (text.length <= budget)
        return text;
    const parts = paragraphs(text), ranked = parts.map((p, i) => ({ i, p, score: (p.match(spatialWords)?.length ?? 0) * 4 + (i === 0 ? 12 : 0) + (i === parts.length - 1 ? 16 : 0) + i / parts.length }));
    ranked.sort((a, b) => b.score - a.score || b.i - a.i);
    const selected = new Set<number>();
    let used = 0;
    for (const part of ranked)
        if (used + part.p.length + 2 <= budget) {
            selected.add(part.i);
            used += part.p.length + 2;
        }
    return parts.filter((_, i) => selected.has(i)).join('\n\n');
}
export function narrativeMapSources(messages: readonly NarrativeMessage[]): {
    messages: NarrativeMessage[];
    sources: NarrativeSource[];
} {
    const sources: NarrativeSource[] = [];
    const annotated = messages.map((message, i) => ({ ...message, text: paragraphs(message.text).map((text, p) => {
            const id = `m${i + 1}.p${p + 1}`;
            sources.push({ id, text });
            return `[${id}] ${text}`;
        }).join('\n\n') }));
    return { messages: annotated, sources };
}
