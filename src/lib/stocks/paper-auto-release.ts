/** Recurring Alpaca PAPER controller release manifest. Server and worker code only.
 * Scheduled runs are ON (owner-approved 2026-10-31): scheduled decision, execute and monitor
 * slots may run, but a scheduled run can never arm the gate (owner actions refuse schedules),
 * so nothing executes until the owner resumes. Broker writes and real money stay OFF.
 * Only a reviewed source change can turn a switch on; environment
 * variables, scheduler events, request bodies and function arguments cannot.
 * Independent of the lifetime one-order release in paper-automation-release.ts.
 */
export const PAPER_AUTO_RELEASE={
  paperOnly:true,
  /** Alpaca PAPER POST /v2/orders and DELETE /v2/orders/{id}. */
  brokerWritesEnabled:false,
  /** Scheduler-triggered worker runs; manual read-only runs never need this. */
  scheduledRunsEnabled:true,
  realMoneyEnabled:false
} as const;
