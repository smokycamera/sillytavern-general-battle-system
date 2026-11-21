import type { NarrativeMessage } from '../../vendor/jev-core/src/index.js';
import type { NarrativeSource } from '../../engine/src/small/scene-intent.js';
function paragraphs(text: string): string[] {
    return text.split(/\n\s*\n/).flatMap(p => p.length <= 1000 ? [p] : p.match(/[\s\S]{1,1000}/g) ?? []).map(p => p.trim()).filter(Boolean);
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
