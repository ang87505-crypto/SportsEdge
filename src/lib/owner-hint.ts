/**
 * Non-secret hint that this browser holds an owner session, so public pages can skip owner-only API calls
 * (which would otherwise answer 401 on every page view for every visitor). It grants nothing: every owner
 * route still verifies the httpOnly signed session cookie. Set and cleared together with that cookie.
 */
export const OWNER_HINT_COOKIE='__Host-sportsedge-owner-hint';
export function ownerHintPresent(cookieHeader:string|null|undefined){
 return (cookieHeader??'').split(';').some(c=>c.trim().startsWith(OWNER_HINT_COOKIE+'=1'));
}
