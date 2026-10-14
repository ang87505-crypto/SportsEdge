/** Public non-sensitive capability manifest; not configurable by client inputs. */
export const PAPER_AUTOMATION_RELEASE={
  paperOnly:true,
  placeOrdersEnabled:false,
  scheduledOrdersEnabled:false,
  realMoneyEnabled:false,
  durableReceiptStoreReady:false,
  emergencyStopOperational:false,
  verifiedLiveSignalSource:false,
  brokerReconciliationComplete:false
} as const;
