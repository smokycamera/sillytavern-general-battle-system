"""Reference token counts for synthetic prompts; not a Claude/Gemini tokenizer claim."""
import json
import sys
import hashlib
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path('artifacts/token-metric').resolve()))
import tiktoken

sample_path = Path('engine/sim/out/narrative-prompt-samples.json')
samples = json.loads(sample_path.read_text(encoding='utf-8'))
rows = {}
for name, texts in samples.items():
    metrics = {'characters': {k: len(v) for k, v in texts.items()}}
    for encoding in ['cl100k_base', 'o200k_base']:
        tokenizer = tiktoken.get_encoding(encoding)
        metrics[encoding] = {k: len(tokenizer.encode(v)) for k, v in texts.items()}
    for metric in metrics.values():
        metric['reductionPercent'] = round((1 - metric['after'] / metric['before']) * 100, 1)
    rows[name] = metrics
result = {'date': datetime.now(timezone.utc).isoformat(), 'tiktoken': tiktoken.__version__, 'sampleSha256': hashlib.sha256(sample_path.read_bytes()).hexdigest(),
          'scope': 'Reference encodings only. Synthetic two-unit state; no real chat or LLM generation success-rate evaluation. Worldbook all means every conditional entry active; common total assumes only constant worldbook entries.', 'samples': rows}
Path('engine/sim/out/worldbook-token-metrics.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
