// 语音转文字。照搬 CopyDeck 的做法：网关上的 gpt-live-transcribe 不开放 /audio/transcriptions，
// 只能走 /v1/realtime（WebSocket，intent=transcription）。
// - LiveDictation：边说边出字的听写。前端每 200ms 送一块 24kHz PCM16，说话停顿处提交一段。
// - transcribeWav：一段 16kHz WAV（上传的录音、视频音轨）整段识别，长的按 2 分钟切开逐段识别。
// 名字里不带 live 的转写模型（whisper、gpt-4o-transcribe 等）走 /audio/transcriptions。

export const DEFAULT_SPEECH_MODEL = "gpt-live-transcribe";
export const isSpeechModel = (id) => typeof id === "string" && /(live|transcrib|whisper)/i.test(id) && !/realtime-preview/i.test(id);
export const usesRealtime = (id) => typeof id === "string" && /live/i.test(id) && !/whisper/i.test(id);
const PROMPT = "中文法律咨询听写，用简体中文和中文标点输出。常用词：劳动合同、用人单位、经济补偿、赔偿金、仲裁、诉讼时效、违约金、民法典、司法解释。";

export function realtimeUrl(baseURL, model) {
  const u = new URL(String(baseURL || "").replace(/\/$/, ""));
  if (!/^https?:$/.test(u.protocol) || !u.pathname.endsWith("/v1")) throw new Error("接口地址要以 /v1 结尾，才能用实时转写");
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname += "/realtime";
  u.searchParams.set("model", model);
  u.searchParams.set("intent", "transcription");
  return u.toString();
}

const sessionUpdate = (model, prompt) => ({
  type: "session.update",
  session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model, language: "zh", ...(prompt ? { prompt: String(prompt).slice(0, 400) } : {}) }, turn_detection: null } } },
});

/** 16kHz/16bit/单声道 WAV → 24kHz PCM16 */
export function wav16kToPcm24k(wav) {
  const at = wav.indexOf(Buffer.from("data"));
  if (at < 0) throw new Error("不是有效的 WAV 数据");
  const src = wav.subarray(at + 8);
  const frames = Math.floor(src.length / 2);
  const n = Math.floor((frames * 24000) / 16000);
  const out = Buffer.allocUnsafe(n * 2);
  for (let i = 0; i < n; i++) {
    const p = (i * 16000) / 24000, l = Math.floor(p), r = Math.min(l + 1, frames - 1), f = p - l;
    out.writeInt16LE(Math.round(src.readInt16LE(l * 2) * (1 - f) + src.readInt16LE(r * 2) * f), i * 2);
  }
  return out;
}

/** 一段 24kHz PCM 走实时接口识别成文字 */
export function realtimeOnce({ baseURL, apiKey, model, pcm, prompt }) {
  return new Promise((resolve, reject) => {
    let text = "", settled = false, sock, t2 = null;
    const finish = (err, val) => {
      if (settled) return;
      settled = true; clearTimeout(t1); clearTimeout(t2);
      try { sock?.close(); } catch {}
      err ? reject(err) : resolve(val);
    };
    const t1 = setTimeout(() => finish(new Error("连接实时转写超时")), 15000);
    try { sock = new WebSocket(realtimeUrl(baseURL, model), { headers: { Authorization: `Bearer ${apiKey}` } }); } catch (e) { return finish(new Error(`连接实时转写失败：${e.message}`)); }
    const send = (o) => sock.send(JSON.stringify(o));
    sock.addEventListener("open", () => send(sessionUpdate(model, prompt)));
    sock.addEventListener("error", (e) => finish(new Error(`连接实时转写失败：${String(e?.message || "网络错误").slice(0, 160)}`)));
    sock.addEventListener("close", () => finish(new Error("实时转写连接中断，没有拿到完整结果")));
    sock.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.type === "session.updated") {
        clearTimeout(t1);
        for (let o = 0; o < pcm.length; o += 9600) send({ type: "input_audio_buffer.append", audio: pcm.subarray(o, o + 9600).toString("base64") });
        send({ type: "input_audio_buffer.commit" });
        t2 = setTimeout(() => finish(new Error("实时转写没有在预期时间内给出结果")), Math.max(30000, (pcm.length / 48000) * 1000 + 20000));
      } else if (m.type === "conversation.item.input_audio_transcription.delta") text += String(m.delta || "");
      else if (m.type === "conversation.item.input_audio_transcription.completed") finish(null, String(m.transcript ?? text).trim());
      else if (m.type === "error" || m.type === "conversation.item.input_audio_transcription.failed") finish(new Error(`实时转写出错：${String(m.error?.message || "未知错误").slice(0, 200)}`));
    });
  });
}

/** 任意采样率的 16 位单声道 PCM → 24kHz（实时转写要求的格式） */
function pcmTo24k(src, rate) {
  if (rate === 24000) return src;
  const frames = Math.floor(src.length / 2), n = Math.floor((frames * 24000) / rate);
  const out = Buffer.allocUnsafe(n * 2);
  for (let i = 0; i < n; i++) {
    const p = (i * rate) / 24000, l = Math.floor(p), r = Math.min(l + 1, frames - 1), f = p - l;
    out.writeInt16LE(Math.round(src.readInt16LE(l * 2) * (1 - f) + src.readInt16LE(r * 2) * f), i * 2);
  }
  return out;
}

/** 单声道 WAV（16kHz 或 24kHz）→ 文字。实时模型按 2 分钟一段识别（网络断了重试）；其他模型走 /audio/transcriptions（10 分钟一段）。 */
export async function transcribeWav({ settings, client, model, wav, onProgress }) {
  model = model || DEFAULT_SPEECH_MODEL;
  const dataAt = wav.indexOf(Buffer.from("data"));
  if (dataAt < 0) throw new Error("不是有效的 WAV 数据");
  const rate = wav.readUInt32LE(24) || 16000;
  const pcm16 = wav.subarray(dataAt + 8);
  const seconds = usesRealtime(model) ? 120 : 600;
  const per = seconds * rate * 2;
  const parts = [];
  for (let off = 0, i = 0; off < pcm16.length; off += per, i++) {
    const part = pcm16.subarray(off, Math.min(pcm16.length, off + per));
    onProgress?.(i, Math.ceil(pcm16.length / per));
    if (usesRealtime(model)) {
      for (let attempt = 0; ; attempt++) {
        try { parts.push(await realtimeOnce({ baseURL: settings.base_url, apiKey: settings.api_key, model, pcm: pcmTo24k(part, rate), prompt: PROMPT })); break; }
        catch (err) { if (attempt >= 3) throw err; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
      }
    } else {
      const { toFile } = await import("openai");
      const r = await client.audio.transcriptions.create({ model, file: await toFile(Buffer.concat([wavHeader(part.length, rate), part]), "audio.wav") });
      parts.push(String(r.text || "").trim());
    }
  }
  return parts.join("\n");
}

/**
 * 上传的录音、视频：同一段声音独立转写三遍，取多数一致的版本。
 * 实测实时转写偶尔会把整句听错（如把「同意支付」听成「从未支付」），而且每次错的地方不一样；三遍取多数能把这种随机错误去掉。
 * 三遍各不相同的地方，交给模型按多数和上下文合并，实在定不下来的标〔听不清：A／B〕，不替用户猜。
 */
export async function transcribeRobust({ settings, client, model, wav, mergeModel, complete }) {
  const runs = await Promise.all([0, 1, 2].map((i) => new Promise((r) => setTimeout(r, i * 400)).then(() => transcribeWav({ settings, client, model, wav }).catch(() => null))));
  const ok = runs.filter((x) => x && x.trim());
  if (!ok.length) throw new Error("录音转写失败（网络或接口出错），请稍后再试");
  const norm = (t) => t.replace(/[\s，。、；：！？,.;:!?“”"'（）()]/g, "");
  for (const a of ok) if (ok.filter((b) => norm(b) === norm(a)).length >= 2) return a;
  if (ok.length === 1 || !mergeModel || !complete) return ok[0];
  const r = await complete(settings, {
    model: mergeModel, effort: "low",
    messages: [{ role: "user", content: `下面是同一段中文录音的 ${ok.length} 份独立转写，内容应当相同，但转写引擎每次会在不同地方听错。请合并成一份最终稿：
- 逐句比较，哪种说法在多数转写里出现就用哪种；
- 各份都不一样的地方，选和上下文意思一致、语句通顺的那种；如果几种说法意思明显不同（例如一份是「同意」一份是「不同意」）且无法判断，写成〔听不清：说法一／说法二〕，不要替用户猜；
- 不要润色、不要改写、不要补充原话里没有的内容；只输出最终稿。
${ok.map((t, i) => `【转写 ${i + 1}】\n${t}`).join("\n\n")}` }],
  });
  return String(r.choices?.[0]?.message?.content || ok[0]).trim();
}

export function wavHeader(bytes, rate = 16000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + bytes, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(bytes, 40);
  return h;
}

/**
 * 实时听写（CopyDeck engine/live-dictation.mjs 的做法）：录音中按停顿提交一段，文字边说边出；
 * 结果按网关 committed 的顺序排，避免并发识别倒序。一口气说太久被按长度硬切过的，结束时整段再识别一遍。
 */
const FINAL_PASS_SECONDS = 90;
export class LiveDictation {
  constructor({ baseURL, apiKey, model = DEFAULT_SPEECH_MODEL, prompt = PROMPT, segmentBytes = 576000 }) {
    this.segmentBytes = segmentBytes; this.finalPassBytes = FINAL_PASS_SECONDS * 48000;
    this.items = new Map(); this.order = []; this.completed = new Set(); this.bytes = 0; this.buffered = 0; this.commits = 0; this.closed = false; this.audio = [];
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.timer = setTimeout(() => this.fail(new Error("连接实时听写超时")), 12000);
    this.lifetime = setTimeout(() => this.fail(new Error("听写超过 3 分钟，请重新开始")), 215000);
    try { this.socket = new WebSocket(realtimeUrl(baseURL, model), { headers: { Authorization: `Bearer ${apiKey}` } }); } catch (error) { this.fail(error); throw error; }
    this.socket.addEventListener("open", () => this.send(sessionUpdate(model, prompt)));
    this.socket.addEventListener("message", (ev) => { let m; try { m = JSON.parse(String(ev.data)); } catch { return; } this.receive(m); });
    this.socket.addEventListener("error", () => this.fail(new Error("实时听写连接失败")));
    this.socket.addEventListener("close", () => { if (!this.closed) this.fail(new Error("实时听写连接中断")); });
  }
  send(m) { if (this.closed) throw this.error || new Error("听写已经结束"); this.socket.send(JSON.stringify(m)); }
  receive(m) {
    if (this.closed) return;
    if (m.type === "session.updated") { clearTimeout(this.timer); this.resolveReady(); return; }
    const id = m.item_id;
    if (this.final && id && (id === this.final.id || (!this.final.id && m.type === "input_audio_buffer.committed"))) {
      if (m.type === "input_audio_buffer.committed") this.final.id = id;
      else if (m.type === "conversation.item.input_audio_transcription.completed") this.final.text = String(m.transcript ?? "");
      else if (m.type === "conversation.item.input_audio_transcription.failed") this.final.failed = true;
      return;
    }
    if (m.type === "error" || m.type === "conversation.item.input_audio_transcription.failed") {
      if (this.final) { this.final.failed = true; return; }
      return this.fail(new Error(String(m.error?.message || "听写识别失败").slice(0, 200)));
    }
    if (!id) return;
    if (m.type === "input_audio_buffer.committed") {
      if (!this.order.includes(id)) { const at = this.order.indexOf(m.previous_item_id); if (at >= 0) this.order.splice(at + 1, 0, id); else this.order.push(id); }
      if (!this.items.has(id)) this.items.set(id, "");
    } else if (m.type === "conversation.item.input_audio_transcription.delta") {
      if (!this.completed.has(id)) this.items.set(id, (this.items.get(id) || "") + String(m.delta || ""));
    } else if (m.type === "conversation.item.input_audio_transcription.completed") {
      this.items.set(id, String(m.transcript ?? this.items.get(id) ?? "")); this.completed.add(id);
    }
  }
  text() { return this.order.map((id) => this.items.get(id) || "").join(""); }
  commit() { if (this.buffered < 4800) return; this.buffered = 0; this.commits++; this.send({ type: "input_audio_buffer.commit" }); }
  async append(audio) {
    await this.ready;
    if (this.ending) throw new Error("听写正在结束");
    if (typeof audio !== "string" || audio.length > 64000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new Error("听写音频块无效");
    const b = Buffer.from(audio, "base64");
    if (!b.length || b.length % 2 || b.length > 48000) throw new Error("音频块必须是 24kHz PCM16，最长 1 秒");
    if (this.bytes + b.length > 24000 * 2 * 180) throw new Error("听写超过 3 分钟");
    this.bytes += b.length; this.buffered += b.length; this.audio.push(b);
    this.send({ type: "input_audio_buffer.append", audio });
    if (this.buffered >= this.segmentBytes) { this.forced = true; this.commit(); }
    return { text: this.text() };
  }
  async boundary() { await this.ready; if (!this.ending) this.commit(); return { text: this.text() }; }
  async wait(done, ms, message) {
    const until = Date.now() + ms;
    while (!done()) {
      if (this.closed) throw this.error || new Error("听写已取消");
      if (Date.now() > until) throw new Error(message);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  async finish() {
    await this.ready; this.ending = true; this.commit();
    if (this.buffered) {
      const pad = Buffer.alloc(4800 - this.buffered); this.audio.push(pad);
      this.send({ type: "input_audio_buffer.append", audio: pad.toString("base64") }); this.buffered = 4800; this.commit();
    }
    try { await this.wait(() => this.completed.size >= this.commits, 20000, "听写收尾超时，已收到的文字保留"); } catch (error) { if (!this.closed) this.fail(error); throw this.error || error; }
    const segments = this.text(); let text = segments;
    if (this.forced && this.commits > 1 && this.bytes <= this.finalPassBytes) {
      this.final = {};
      try {
        const all = Buffer.concat(this.audio);
        for (let o = 0; o < all.length; o += 48000) this.send({ type: "input_audio_buffer.append", audio: all.subarray(o, o + 48000).toString("base64") });
        this.send({ type: "input_audio_buffer.commit" });
        await this.wait(() => this.final.text != null || this.final.failed, 8000, "整段识别超时");
        if (this.final.text && this.final.text.trim()) text = this.final.text;
      } catch {}
    }
    this.close();
    return { text, segments };
  }
  fail(error) { if (this.closed) return; this.error = error; this.rejectReady(error); this.close(); }
  close() { if (this.closed) return; this.closed = true; this.audio = []; this.rejectReady(this.error || new Error("听写已结束")); clearTimeout(this.timer); clearTimeout(this.lifetime); try { this.socket.close(); } catch {} }
}
