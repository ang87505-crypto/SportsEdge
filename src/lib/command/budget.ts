/**
 * Command Center 2.0: rate limits and inference cost budget. In-memory per server instance (serverless instances do
 * not share it), so it is a guard, not an accounting system: the hard limits are per request (max tokens, max tool
 * rounds) and a DAILY USD cap that must be configured explicitly by the owner. With no cap configured, paid inference
 * is never used.
 */
export const PRICES_PER_MTOK:Record<string,{input:number;output:number}>={
 // Anthropic first-party list prices (USD per million tokens), checked 2026-11-13.
 'claude-opus-5-5':{input:4,output:20},'claude-sonnet-5-5':{input:2,output:10},'claude-haiku-5-5':{input:0.1,output:0.5},
};
export const costUsd=(model:string,u:{input_tokens:number;output_tokens:number})=>{
 const p=PRICES_PER_MTOK[model];if(!p)return Infinity;   // unknown model: treated as unaffordable
 return (u.input_tokens*p.input+u.output_tokens*p.output)/1e6;
};

export class RateLimiter{
 private hits=new Map<string,number[]>();
 readonly perMinute:number;readonly maxKeys:number;
 constructor(perMinute:number,maxKeys=5000){this.perMinute=perMinute;this.maxKeys=maxKeys;}
 allow(key:string,nowMs:number):boolean{
  const recent=(this.hits.get(key)??[]).filter(t=>nowMs-t<60_000);
  if(recent.length>=this.perMinute){this.hits.set(key,recent);return false;}
  recent.push(nowMs);this.hits.set(key,recent);
  if(this.hits.size>this.maxKeys)this.hits.delete(this.hits.keys().next().value!);   // bounded memory
  return true;
 }
}

export class DailyBudget{
 private day='';private spent=0;
 readonly capUsd:number;
 constructor(capUsd:number){this.capUsd=capUsd;}
 private roll(nowIso:string){const d=nowIso.slice(0,10);if(d!==this.day){this.day=d;this.spent=0;}}
 /** Whether a call whose worst case costs `worstUsd` may start. */
 canSpend(worstUsd:number,nowIso:string){this.roll(nowIso);return this.capUsd>0&&Number.isFinite(worstUsd)&&this.spent+worstUsd<=this.capUsd;}
 record(usd:number,nowIso:string){this.roll(nowIso);this.spent+=Number.isFinite(usd)?usd:this.capUsd;}
 remaining(nowIso:string){this.roll(nowIso);return Math.max(0,this.capUsd-this.spent);}
}

export type LlmConfig={provider:'anthropic';model:string;dailyCapUsd:number;maxOutputTokens:number;maxToolRounds:number;maxInputTokensEstimate:number}|null;
/** Paid inference is OFF unless every one of these is set explicitly. Defaults never enable it. */
export function llmConfig(env:Readonly<Record<string,string|undefined>>):LlmConfig{
 const cap=Number(env.COMMAND_LLM_DAILY_BUDGET_USD);
 if(env.COMMAND_LLM_PROVIDER!=='anthropic'||!env.ANTHROPIC_API_KEY||!(cap>0)||cap>50)return null;
 const model=env.COMMAND_LLM_MODEL||'claude-opus-5-5';
 if(!PRICES_PER_MTOK[model])return null;
 return {provider:'anthropic',model,dailyCapUsd:cap,maxOutputTokens:2000,maxToolRounds:4,maxInputTokensEstimate:30_000};
}
