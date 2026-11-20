/**
 * Which Alpaca PAPER key pair each recurring experiment uses. SERVER/CI ONLY.
 * Every experiment trades its own dedicated paper account (the database refuses to register
 * two experiments on one account). There is no fallback between pairs: an experiment whose
 * pair is not configured has no keys, so it cannot reach another experiment's account.
 *   pair 1: ALPACA_PAPER_AUTO_KEY_ID / ALPACA_PAPER_AUTO_SECRET_KEY (every other experiment)
 *   pair 2: ALPACA_PAPER_AUTO_2_KEY_ID / ALPACA_PAPER_AUTO_2_SECRET_KEY
 */
const PAIR_BY_EXPERIMENT:Readonly<Record<string,2>>={'stock-v3-steady-weekly-1':2};

type Env=Readonly<Record<string,string|undefined>>;
export type PaperAutoKeys={pair:1|2;keyId:string;secretKey:string;configured:boolean};

export function paperAutoKeys(experimentId:string,env:Env):PaperAutoKeys{
 const pair=Object.hasOwn(PAIR_BY_EXPERIMENT,experimentId)?PAIR_BY_EXPERIMENT[experimentId]:1;
 const prefix=pair===1?'ALPACA_PAPER_AUTO_':'ALPACA_PAPER_AUTO_2_';
 const keyId=env[prefix+'KEY_ID']??'',secretKey=env[prefix+'SECRET_KEY']??'';
 return {pair,keyId,secretKey,configured:keyId.length>0&&secretKey.length>0};
}
