import {connection} from 'next/server';
import {handleDiagnosticRequest} from '@/lib/server/alpaca-paper-diagnostic';

// Admin-only bearer, not an owner browser login. Do not import this endpoint into
// client components or put the bearer in NEXT_PUBLIC_* / browser localStorage.
export async function GET(request:Request) {
  // Reading headers from the Request argument is not a Request-time API under
  // Cache Components, so without this the 404 is prerendered at build time.
  await connection();
  return handleDiagnosticRequest(request,process.env);
}
