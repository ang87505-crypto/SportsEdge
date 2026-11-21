/** Frozen #195 real-line shadow contract. No selection, fitting, control changes or I/O. */
import {createHash} from 'node:crypto';
import fit from '../../../research/props_monotone_cal_v1_20261120/fit.json' with {type:'json'};
import {CHALLENGER_ID,calibrate,calibrationDigest,type MonotoneCalibration} from './monotone-calibration.ts';
import {validProbabilities,type Probabilities} from './research.ts';
import {STATS,type Stat} from './contract.ts';

export const MONOTONE_SHADOW={model:CHALLENGER_ID,
 digest:'8b84007d37b9084a7cd486fe3f387bf6d2ac0062d6b230d48f79310924f4a633',
 baselineDigest:'4ca4be3779f188c3aa5dc6ccd2b24ceabf9cd07d1dfac0b534b59d26918298be',
 // Integration contract creation, not a claim that production was recording at this time.
 notBefore:'2026-11-21T03:37:17Z'} as const;
export const modelDigest=(model:unknown)=>createHash('sha256').update(JSON.stringify(model)).digest('hex');

export function verifiedMonotoneCalibration(raw:unknown=fit):MonotoneCalibration{
 const f=raw as {challenger?:string;forward?:{digest?:string;monotone?:MonotoneCalibration}};
 const c=f?.forward?.monotone;
 if(f?.challenger!==CHALLENGER_ID||f.forward?.digest!==MONOTONE_SHADOW.digest||!c||
  calibrationDigest(c)!==MONOTONE_SHADOW.digest||c.challenger!==CHALLENGER_ID||
  !STATS.every(s=>c.trainingLines[s]>=2000&&c.byStat[s]?.knots.length===20))throw Error('MONOTONE_SHADOW_ARTIFACT_MISMATCH');
 return c;
}

/** The map was fit on binary, non-tie probabilities. Preserve the baseline's explicit integer-line tie mass. */
export function monotoneShadowProbability(stat:Stat,p:Probabilities,c:MonotoneCalibration=verifiedMonotoneCalibration()):Probabilities{
 if(!validProbabilities(p))throw Error('MONOTONE_SHADOW_INVALID_PROBABILITIES');
 const mass=p.pMore+p.pLess;
 if(mass===0)return {...p};
 const q=calibrate(c,stat,p.pMore/mass),pMore=q*(1-p.pTie);
 return {pMore,pLess:1-p.pTie-pMore,pTie:p.pTie};
}
