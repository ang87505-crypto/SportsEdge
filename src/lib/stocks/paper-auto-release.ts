/** Recurring Alpaca PAPER controller release manifest. Server and worker code only.
 * Every switch is OFF. Only a reviewed source change can turn one on; environment
 * variables, scheduler events, request bodies and function arguments cannot.
 * Independent of the lifetime one-order release in paper-automation-release.ts.
 */
export const PAPER_AUTO_RELEASE={
  paperOnly:true,
  /** Alpaca PAPER POST /v2/orders and DELETE /v2/orders/{id}. */
  brokerWritesEnabled:false,
  /** Scheduler-triggered worker runs; manual read-only runs never need this. */
  scheduledRunsEnabled:false,
  realMoneyEnabled:false
} as const;
