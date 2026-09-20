// Recovered verbatim from the user-supplied 20260918 release; keep naming behavior stable.
export function tbWeaponShortName(w: { name?: unknown } | null | undefined): string {
    var raw = (w && w.name) ? String(w.name).trim() : '';
    if (!raw) return '';
    var n = raw, specd = false;
    var sep = n.search(/[:\uFF1A\u00B7\uFF5C|/\uFF0F]/);
    if (sep > 0) { n = n.slice(0, sep).trim(); specd = true; }
    var m = n.match(/[lL]\s*\d{1,2}(\s*[+\uFF0B]\s*\d{1,2})?$/);
    if (m) { n = n.slice(0, m.index).trim(); specd = true; }
    if (specd && n) {
        var kws = ['\u8F7B\u578B\u6295\u5C04','\u7206\u7834\u88C5\u7F6E','\u80FD\u91CF\u6B66\u5668','\u957F\u5175\u5668','\u5F13\u5F13','\u94DD\u5668','\u6CD5\u6756','\u706B\u70AE','\u706B\u67AA','\u6B65\u67AA','\u673A\u70AE','\u8230\u70AE','\u91CE\u6218\u70AE','\u5766\u514B\u70AE','\u69B4\u5F39\u70AE','\u8FEB\u51FB\u70AE','\u7B49\u79BB\u5B50','\u8F68\u9053\u70AE','\u8109\u51B2\u70AE','\u72D9\u51FB\u67AA','\u7A81\u51FB\u6B65\u67AA','\u673A\u67AA','\u5361\u5BBE\u67AA','\u6ED1\u81C5\u67AA','\u71CE\u53D1\u67AA','\u706B\u7EF3\u67AA','\u706B\u94F3','\u77ED\u94F3','\u6B66\u58EB\u5200','\u94FE\u952F\u5251','\u7206\u5F39\u67AA','\u667A\u80FD\u67AA','\u6FC0\u5149\u67AA','\u5DE8\u5251','\u957F\u5251','\u77ED\u5251','\u9A91\u67AA','\u957F\u67AA','\u957F\u77DB','\u67AA\u77DB','\u957F\u67C4','\u6218\u65A7','\u5DE8\u65A7','\u624B\u65A7','\u624B\u5F29','\u624B\u67AA','\u957F\u5F13','\u77ED\u5F13','\u590D\u5408\u5F13','\u5F13\u7BAD','\u9A91\u5F13','\u621F','\u77DB','\u5F29','\u5F13','\u5251','\u5200','\u65A7','\u67AA','\u70AE','\u94F3'];
        var best = '';
        for (var k = 0; k < kws.length; k++) if (n.endsWith(kws[k]!) && kws[k]!.length > best.length) best = kws[k]!;
        if (best && n.length - best.length >= 2) n = n.slice(0, n.length - best.length).trim();
    }
    return n || raw;
}
