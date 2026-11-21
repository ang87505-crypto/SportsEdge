import {propsStore,PropsStoreError} from './props-store.ts';
import {labStoreConfigured} from './lab-load.ts';
import {readPennyStudy} from './penny-paper-worker.ts';
export async function loadPennyPaper(nowIso=new Date().toISOString()){
 if(!labStoreConfigured())return {state:'not_configured' as const,cohort:null,summary:null};
 try{return await readPennyStudy({store:propsStore(),now:()=>nowIso});}
 catch(e){return {state:'unavailable' as const,cohort:null,summary:null,code:e instanceof PropsStoreError?e.code:'INTEGRITY_OR_READ_ERROR'};}
}
