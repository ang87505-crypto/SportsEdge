/** Public Git identity of a Vercel deployment (see src/app/api/version/route.ts). Only allow-listed, validated fields. */
export type DeploymentIdentity={schemaVersion:'deployment-identity-v1';commitSha:string|null;commitRef:string|null;environment:string|null};

export function deploymentIdentity(env:Readonly<Record<string,string|undefined>>):DeploymentIdentity{
 const sha=env.VERCEL_GIT_COMMIT_SHA??'',ref=env.VERCEL_GIT_COMMIT_REF??'',vercelEnv=env.VERCEL_ENV??'';
 return {schemaVersion:'deployment-identity-v1',
  commitSha:/^[0-9a-f]{40}$/.test(sha)?sha:null,
  commitRef:/^[A-Za-z0-9._\/-]{1,200}$/.test(ref)?ref:null,
  environment:['production','preview','development'].includes(vercelEnv)?vercelEnv:null};
}

/**
 * Compare the deployed identity with `main`. A new `main` commit gets `graceMinutes` to build and roll out.
 * States: MATCHES_MAIN, DEPLOYING (main is newer but still inside its grace), BEHIND_MAIN, WRONG_BRANCH, UNKNOWN.
 */
export function compareDeployment(id:DeploymentIdentity|null,main:{sha:string;committedAt:string}|null,nowMs:number,graceMinutes=45){
 if(!id||!id.commitSha||!main)return {state:'UNKNOWN' as const,detail:'Deployment identity or main head unavailable.'};
 if(id.commitRef&&id.commitRef!=='main')return {state:'WRONG_BRANCH' as const,detail:`Production serves branch ${id.commitRef}, not main.`};
 if(id.commitSha===main.sha)return {state:'MATCHES_MAIN' as const,detail:`Production serves main ${main.sha.slice(0,7)}.`};
 const age=(nowMs-Date.parse(main.committedAt))/60_000;
 if(Number.isFinite(age)&&age<graceMinutes)return {state:'DEPLOYING' as const,detail:`main ${main.sha.slice(0,7)} is ${Math.round(age)} min old; production still serves ${id.commitSha.slice(0,7)}.`};
 return {state:'BEHIND_MAIN' as const,detail:`Production serves ${id.commitSha.slice(0,7)}; main is ${main.sha.slice(0,7)} (${Number.isFinite(age)?Math.round(age)+' min':'unknown time'} old). The latest Vercel production build may have failed.`};
}
