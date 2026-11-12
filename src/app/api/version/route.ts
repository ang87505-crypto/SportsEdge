/**
 * Public deployment identity: which commit and branch this deployment was built from. Lets the operations monitor
 * (GitHub Actions, no Vercel credentials) check that production serves the reviewed `main` commit and that no other
 * branch was promoted. Values are the public Git metadata Vercel sets at build time; no secret is read or returned.
 * Prerendered per deployment, which is correct: the build's commit is the deployment's commit.
 */
import {deploymentIdentity} from '@/lib/deployment-identity';

export function GET(){
 return Response.json(deploymentIdentity(process.env),{headers:{'Cache-Control':'no-store'}});
}
