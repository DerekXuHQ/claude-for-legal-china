// 听写采集（24kHz）：每 200ms 发一块 PCM16；说话中停顿够久（GAP）且这一段够长（MIN_SEG）才发 boundary 提交一段。
// 以前停 300ms 就切，一个词中间换口气都会被切开单独识别（「答非所问」→「答非。索問」），现在宁可晚一点出字也要整句识别。
const GAP=19200,MIN_SEG=36000;   // 停顿 800ms；一段至少 1.5 秒
class DictationCapture extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.prefix=[];this.quiet=0;this.speaking=false;this.seg=0;this.port.onmessage=e=>{if(e.data==='flush'){this.ending=true;this.flush();this.port.postMessage('flushed');}};}
 flush(){if(!this.samples.length)return;const pcm=new Int16Array(this.samples.length);for(let i=0;i<pcm.length;i++){const x=Math.max(-1,Math.min(1,this.samples[i]));pcm[i]=Math.round(x*(x<0?32768:32767));}this.samples=[];this.port.postMessage(pcm.buffer,[pcm.buffer]);}
 process(inputs){
  if(this.ending)return true;const a=inputs[0]?.[0];if(!a)return true;
  let power=0;for(const x of a)power+=x*x;const voiced=Math.sqrt(power/a.length)>.012;
  if(!this.speaking&&!voiced){this.prefix.push(...a);if(this.prefix.length>4800)this.prefix=this.prefix.slice(-4800);return true;}
  if(!this.speaking){this.speaking=true;this.samples.push(...this.prefix);this.seg+=this.prefix.length;this.prefix=[];}
  this.samples.push(...a);this.seg+=a.length;this.quiet=voiced?0:this.quiet+a.length;
  if(this.samples.length>=4800)this.flush();
  if(this.quiet>=GAP){this.flush();this.speaking=false;this.quiet=0;if(this.seg>=MIN_SEG){this.port.postMessage('boundary');this.seg=0;}}
  return true;
 }
}
registerProcessor('dictation-capture',DictationCapture);
