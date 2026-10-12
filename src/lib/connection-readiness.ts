/** Validate read-only status payloads without assuming an HTTP 200 means usable data. */
export function storedOddsAvailable(value:unknown):boolean{
 if(!value||typeof value!=='object')return false;
 const data=value as Record<string,unknown>;
 return data.status==='stored'&&Array.isArray(data.games);
}
export type PublicOwnerControlStatus={configured:boolean;owner:boolean;enabled:boolean;stocksReady:boolean};
export function parseOwnerStatus(value:unknown):PublicOwnerControlStatus|null{
 if(!value||typeof value!=='object')return null;
 const d=value as Record<string,unknown>;
 return ['configured','owner','enabled','stocksReady'].every(k=>typeof d[k]==='boolean')
  ?{configured:d.configured as boolean,owner:d.owner as boolean,enabled:d.enabled as boolean,stocksReady:d.stocksReady as boolean}
  :null;
}
