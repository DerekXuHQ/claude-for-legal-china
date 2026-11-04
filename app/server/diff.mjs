// 两个版本之间按条对比：先找文字完全相同的条（可能换了条号），再按相似度配对修改过的条。

const HEAD = /^第[零〇一二三四五六七八九十百千]+条(之[零〇一二三四五六七八九十百千]+)?\s*/;

function norm(text) {
  return (text || "")
    .replace(HEAD, "")
    .replace(/[\s　]+/g, "")
    .replace(/（/g, "(").replace(/）/g, ")").replace(/，/g, ",").replace(/；/g, ";").replace(/：/g, ":");
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  for (const [g, v] of a) inter += Math.min(v, b.get(g) || 0);
  return (2 * inter) / (na + nb);
}

/**
 * @param {{id?:string, article_cn:string, text:string}[]} oldArts
 * @param {{id?:string, article_cn:string, text:string}[]} newArts
 */
export function diffArticles(oldArts, newArts) {
  const oldN = oldArts.map((a) => ({ a, n: norm(a.text), used: false }));
  const newN = newArts.map((a) => ({ a, n: norm(a.text), used: false }));
  const byText = new Map();
  for (const o of oldN) {
    if (!byText.has(o.n)) byText.set(o.n, []);
    byText.get(o.n).push(o);
  }
  let unchanged = 0, renumbered = 0;
  for (const x of newN) {
    const list = byText.get(x.n);
    const o = list?.find((y) => !y.used);
    if (o) {
      o.used = x.used = true;
      unchanged++;
      if (o.a.article_cn !== x.a.article_cn) renumbered++;
    }
  }
  const modified = [];
  const oldLeft = oldN.filter((o) => !o.used).map((o) => ({ ...o, g: bigrams(o.n) }));
  for (const x of newN.filter((y) => !y.used)) {
    const g = bigrams(x.n);
    let best = null, bestScore = 0;
    for (const o of oldLeft) {
      if (o.used) continue;
      const s = dice(g, o.g);
      if (s > bestScore) { bestScore = s; best = o; }
    }
    if (best && bestScore >= 0.5) {
      best.used = x.used = true;
      modified.push({ old_cn: best.a.article_cn, new_cn: x.a.article_cn, old_id: best.a.id, new_id: x.a.id, old: best.a.text, new: x.a.text, similarity: Math.round(bestScore * 100) / 100 });
    }
  }
  const added = newN.filter((x) => !x.used).map((x) => ({ new_cn: x.a.article_cn, new_id: x.a.id, new: x.a.text }));
  const removed = oldLeft.filter((o) => !o.used).map((o) => ({ old_cn: o.a.article_cn, old_id: o.a.id, old: o.a.text }));
  const total = Math.max(oldArts.length, newArts.length) || 1;
  return {
    unchanged, renumbered, modified, added, removed,
    old_count: oldArts.length, new_count: newArts.length,
    identical: modified.length === 0 && added.length === 0 && removed.length === 0 && renumbered === 0,
    same_ratio: unchanged / total,
  };
}

export function diffSummary(d) {
  if (d.identical) return "条文一致";
  const parts = [];
  if (d.modified.length) parts.push(`修改 ${d.modified.length} 条`);
  if (d.added.length) parts.push(`新增 ${d.added.length} 条`);
  if (d.removed.length) parts.push(`删除 ${d.removed.length} 条`);
  if (d.renumbered) parts.push(`条号变动 ${d.renumbered} 条`);
  return parts.join("，") + `（旧版 ${d.old_count} 条，新版 ${d.new_count} 条）`;
}
